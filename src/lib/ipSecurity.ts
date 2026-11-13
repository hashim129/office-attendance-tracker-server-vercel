import { Employee, OfficeSettings } from '../types';

export interface ClientNetworkIdentity {
  ip: string;
  ipv4?: string;
  ipv6?: string;
  isp: string;
  asn: string;
}

/**
 * Normalizes an IPv6 address into lowercase hex groups without leading zeros.
 * Expands '::' abbreviations to reconstruct all 8 16-bit groups.
 */
export function normalizeIpv6(ip: string): string[] | null {
  const clean = ip.trim().toLowerCase();
  if (!clean.includes(':')) return null;

  // Strip trailing colons, CIDR, or wildcards
  const base = clean.split('*')[0].split('/')[0].replace(/:+$/, '');
  const parts = base.split('::');
  const left = parts[0] ? parts[0].split(':').filter(Boolean) : [];
  const right = parts[1] ? parts[1].split(':').filter(Boolean) : [];
  const missing = 8 - (left.length + right.length);
  const middle = missing > 0 && parts.length > 1 ? new Array(missing).fill('0') : [];
  const full = [...left, ...middle, ...right];

  try {
    return full.map((g) => parseInt(g || '0', 16).toString(16));
  } catch {
    return null;
  }
}

/**
 * Checks whether a single IP matches an allowed IP rule.
 * Supports:
 * - Exact match: "175.107.239.140"
 * - Wildcard IPv4: "175.107.239.*" or "175.107.*"
 * - IPv4 CIDR: "175.107.239.0/24" or "/16"
 * - IPv6 Subnet: Matches standard /64 office Wi-Fi prefix (first 4 groups),
 *   allowing all devices on the same office IPv6 router to connect without
 *   being blocked by SLAAC/RFC 4941 randomized device privacy extensions.
 * - IPv6 Wildcard: "2400:adc5:1b5:9f00:*"
 * - IPv6 CIDR: "/64", "/56", "/48"
 */
export function doesIpMatchRule(clientIp: string, ruleIp: string): boolean {
  const cleanClient = String(clientIp || '').trim().toLowerCase();
  const cleanRule = String(ruleIp || '').trim().toLowerCase();

  if (!cleanClient || !cleanRule) return false;
  if (cleanClient === cleanRule) return true;

  // 1. IPv6 Subnet & Wildcard Matching
  if (cleanClient.includes(':') && cleanRule.includes(':')) {
    const cNorm = normalizeIpv6(cleanClient);
    const rNorm = normalizeIpv6(cleanRule);
    if (cNorm && rNorm) {
      let requiredGroups = 4; // Standard IPv6 office router subnet is /64 (first 4 groups)
      if (cleanRule.includes('/48')) requiredGroups = 3;
      else if (cleanRule.includes('/56')) requiredGroups = 4;
      else if (cleanRule.includes('/64')) requiredGroups = 4;
      else if (cleanRule.includes('*')) {
        const pre = cleanRule.split('*')[0].replace(/:+$/, '');
        requiredGroups = pre.split(':').filter(Boolean).length || 4;
      }

      const count = Math.min(requiredGroups, cNorm.length, rNorm.length);
      let match = true;
      for (let i = 0; i < count; i++) {
        if (cNorm[i] !== rNorm[i]) {
          match = false;
          break;
        }
      }
      if (match) return true;
    }
  }

  // 2. IPv4 Wildcard matching e.g. 175.107.239.*
  if (cleanRule.includes('*')) {
    const prefix = cleanRule.split('*')[0];
    if (prefix && cleanClient.startsWith(prefix)) {
      return true;
    }
  }

  // 3. IPv4 CIDR matching (/24 or /16)
  if (cleanRule.includes('/') && !cleanRule.includes(':')) {
    const [baseIp, bitsStr] = cleanRule.split('/');
    const bits = parseInt(bitsStr, 10);
    const clientParts = cleanClient.split('.');
    const baseParts = baseIp.split('.');
    if (clientParts.length === 4 && baseParts.length === 4) {
      if (bits === 24 && clientParts.slice(0, 3).join('.') === baseParts.slice(0, 3).join('.')) {
        return true;
      }
      if (bits === 16 && clientParts.slice(0, 2).join('.') === baseParts.slice(0, 2).join('.')) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Detects client Public IPv4/IPv6 address AND their Internet Service Provider (ISP).
 * Checks both the application origin (/api/my-ip) and public lookup services in parallel
 * so dual-stack devices have both IPv4 and IPv6 detected for reliable verification.
 */
export async function detectClientNetwork(): Promise<ClientNetworkIdentity> {
  let detectedIp = 'Unknown';
  let detectedIpv4: string | undefined;
  let detectedIpv6: string | undefined;
  let detectedIsp = 'Unknown ISP';
  let detectedAsn = '';

  // 1. Query origin /api/my-ip (zero rate limits, fast, same origin)
  const myIpPromise = (async () => {
    try {
      const res = await fetch('/api/my-ip', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (data && typeof data.ip === 'string' && data.ip.trim()) {
          const ipStr = data.ip.trim();
          if (ipStr.includes(':')) {
            detectedIpv6 = ipStr;
          } else {
            detectedIpv4 = ipStr;
          }
          if (detectedIp === 'Unknown') detectedIp = ipStr;
          if (data.asn) detectedAsn = data.asn;
        }
      }
    } catch {}
  })();

  // 2. Query ipwho.is for ISP name, ASN, and Public IP
  const ipwhoPromise = (async () => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      const res = await fetch('https://ipwho.is/', {
        signal: controller.signal,
        cache: 'no-store',
      });
      clearTimeout(timeout);
      if (res.ok) {
        const data = await res.json();
        if (data && data.ip && data.success !== false) {
          const ipStr = String(data.ip).trim();
          if (ipStr.includes(':')) {
            detectedIpv6 = ipStr;
          } else {
            detectedIpv4 = ipStr;
          }
          if (detectedIp === 'Unknown') detectedIp = ipStr;
          const ispName = data.connection?.isp || data.connection?.org || '';
          if (ispName) detectedIsp = String(ispName).trim();
          if (data.connection?.asn) detectedAsn = `AS${data.connection.asn}`;
        }
      }
    } catch {}
  })();

  // 3. Query guaranteed IPv4 endpoint api.ipify.org
  const ipifyV4Promise = (async () => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3500);
      const res = await fetch('https://api.ipify.org?format=json', {
        signal: controller.signal,
        cache: 'no-store',
      });
      clearTimeout(timeout);
      if (res.ok) {
        const data = await res.json();
        if (data && typeof data.ip === 'string' && data.ip.trim()) {
          detectedIpv4 = data.ip.trim();
          if (detectedIp === 'Unknown' && detectedIpv4) detectedIp = detectedIpv4;
        }
      }
    } catch {}
  })();

  await Promise.allSettled([myIpPromise, ipwhoPromise, ipifyV4Promise]);

  // Fallback ISP resolution by ASN if name was not retrieved
  if (detectedIsp === 'Unknown ISP' && detectedAsn) {
    const cleanAsn = detectedAsn.toUpperCase();
    if (cleanAsn.includes('9541')) {
      detectedIsp = 'Cyber Internet Services (Cybernet)';
    } else if (cleanAsn.includes('17557')) {
      detectedIsp = 'Pakistan Telecommunication Company Limited (PTCL)';
    } else if (cleanAsn.includes('24499')) {
      detectedIsp = 'Nayatel';
    } else if (cleanAsn.includes('38229')) {
      detectedIsp = 'StormFiber (Cybernet)';
    }
  }

  return {
    ip: detectedIp,
    ipv4: detectedIpv4,
    ipv6: detectedIpv6,
    isp: detectedIsp,
    asn: detectedAsn,
  };
}

/**
 * Legacy helper returning just the IP string
 */
export async function detectClientIp(): Promise<string> {
  const info = await detectClientNetwork();
  return info.ip;
}

/**
 * Checks whether an ISP name matches a configured rule or common aliases
 */
function doesIspMatch(clientIsp: string, ruleIsp: string): boolean {
  const c = clientIsp.toLowerCase().replace(/[^\w]/g, '');
  const r = ruleIsp.toLowerCase().replace(/[^\w]/g, '');
  if (!c || !r) return false;
  if (c.includes(r) || r.includes(c)) return true;

  // Specific alias matching for Pakistani ISPs
  const isCybernet = (s: string) => s.includes('cyber') || s.includes('cybernet');
  const isPtcl = (s: string) => s.includes('ptcl') || s.includes('pakistantelecom');
  const isNayatel = (s: string) => s.includes('nayatel');
  const isStormFiber = (s: string) => s.includes('stormfiber');

  if (isCybernet(c) && isCybernet(r)) return true;
  if (isPtcl(c) && isPtcl(r)) return true;
  if (isNayatel(c) && isNayatel(r)) return true;
  if (isStormFiber(c) && isStormFiber(r)) return true;

  return false;
}

/**
 * Evaluates whether the current user, IP (IPv4 and/or IPv6), and ISP are allowed to mark attendance.
 */
export function verifyOfficeIpAccess(
  clientIp: string,
  settings: OfficeSettings,
  user?: Employee | null,
  clientIsp?: string,
  alternateIp?: string
): {
  allowed: boolean;
  reason?: string;
  matchedLabel?: string;
} {
  if (!settings.enforceOfficeIpLock) {
    return { allowed: true, matchedLabel: 'IP Lock Disabled' };
  }

  // 1. Check if Work From Home (WFH) is enabled for this specific employee
  if (user?.allowWorkFromHome) {
    return {
      allowed: true,
      matchedLabel: 'Work From Home (WFH Remote Allowed)',
    };
  }

  // 2. Check if Admin bypass is enabled for Admin role
  if (user?.role === 'admin' && settings.allowAdminBypassIpLock) {
    return {
      allowed: true,
      matchedLabel: 'Admin Remote Bypass',
    };
  }

  const allowedList = settings.allowedOfficeIps || [];
  const allowedIsps = settings.allowedOfficeIsps || [];

  if (allowedList.length === 0 && allowedIsps.length === 0) {
    return {
      allowed: true,
      matchedLabel: 'No IPs/ISPs configured yet',
    };
  }

  // Collect candidate IPs (handles dual-stack IPv4 and IPv6)
  const candidateIps = Array.from(new Set([clientIp, alternateIp].filter((ip): ip is string => Boolean(ip && ip !== 'Unknown' && ip !== 'Detecting...'))));

  // 3. Check if ANY candidate IP matches any configured Office IP / Subnet
  for (const item of allowedList) {
    for (const ip of candidateIps) {
      if (doesIpMatchRule(ip, item.ip)) {
        return {
          allowed: true,
          matchedLabel: item.label || `Authorized Office IP (${item.ip})`,
        };
      }
    }
  }

  // 4. Check if the ISP matches any configured Office Internet Provider
  if (clientIsp && clientIsp !== 'Unknown ISP' && clientIsp !== 'Detected via IP') {
    // 4a. Match against explicit allowedOfficeIsps list
    for (const ispItem of allowedIsps) {
      if (doesIspMatch(clientIsp, ispItem.ispName)) {
        return {
          allowed: true,
          matchedLabel: `${ispItem.label || 'Authorized Office ISP'} (${ispItem.ispName})`,
        };
      }
    }

    // 4b. Match against ISP mentions in IP rule labels (e.g. "Office ISP (Cyber Internet Services)")
    for (const item of allowedList) {
      if (item.label && doesIspMatch(clientIsp, item.label)) {
        return {
          allowed: true,
          matchedLabel: item.label,
        };
      }
    }
  }

  const displayIp = candidateIps.join(' / ') || clientIp || 'Unknown';
  return {
    allowed: false,
    reason: `Your current network (IP: ${displayIp}${clientIsp && clientIsp !== 'Unknown ISP' ? `, ISP: ${clientIsp}` : ''}) is not recognized as an authorized Office Internet Provider. Please connect to an Office Wi-Fi, Extender, or Office Ethernet cable to mark attendance.`,
  };
}
