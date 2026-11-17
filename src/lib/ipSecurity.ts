import { Employee, OfficeSettings } from '../types';

export interface ClientNetworkIdentity {
  ip: string;
  ipv4?: string;
  ipv6?: string;
  isp: string;
  asn: string;
  /** The address our own server sees for this device (this is what the server-side lock checks). */
  serverSeenIp?: string;
}

// Exact office-network matching (IPv4 + IPv6). Mirrors api/_netmatch.js - keep the two in sync.
// The office is identified ONLY by its public IP addresses; an internet company name never grants access.

const ZERO = BigInt(0);

function parseV4(s: string): bigint | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  let n: bigint = ZERO;
  for (let i = 1; i <= 4; i++) {
    const o = Number(m[i]);
    if (o > 255) return null;
    n = (n << BigInt(8)) | BigInt(o);
  }
  return n;
}

function parseV6(s: string): bigint | null {
  let str = s;
  let tailV4: bigint | null = null;
  const lastColon = str.lastIndexOf(':');
  if (str.includes('.') && lastColon >= 0) {
    tailV4 = parseV4(str.slice(lastColon + 1));
    if (tailV4 === null) return null;
    str = str.slice(0, lastColon + 1) + '0:0';
  }
  const halves = str.split('::');
  if (halves.length > 2) return null;
  const toGroups = (h: string) => (h === '' ? [] : h.split(':'));
  const left = toGroups(halves[0]);
  const right = halves.length === 2 ? toGroups(halves[1]) : [];
  const missing = 8 - left.length - right.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...left, ...new Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...right];
  if (groups.length !== 8) return null;
  let n: bigint = ZERO;
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    n = (n << BigInt(16)) | BigInt(parseInt(g, 16));
  }
  if (tailV4 !== null) n = (n & ~BigInt(0xffffffff)) | tailV4;
  return n;
}

/** -> { v: 4 | 6, n: bigint } or null */
export function parseIp(raw: string): { v: 4 | 6; n: bigint } | null {
  let s = String(raw || '').trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^\[|\]$/g, '').split('%')[0];
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (mapped) s = mapped[1];
  if (s.includes(':')) {
    const n = parseV6(s);
    return n === null ? null : { v: 6, n };
  }
  const n = parseV4(s);
  return n === null ? null : { v: 4, n };
}

/** -> { v, base, bits } or null (invalid or dangerously broad) */
export function parseRule(raw: string): { v: 4 | 6; base: bigint; bits: number } | null {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return null;

  if (s.includes('*')) {
    const pre = s.split('*')[0].replace(/[.:]+$/, '');
    if (!pre) return null;
    if (pre.includes(':')) {
      const groups = pre.split(':').filter((g) => g !== '');
      if (groups.length < 2 || groups.length > 7 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
      const n = parseV6(groups.join(':') + new Array<string>(8 - groups.length).fill(':0').join(''));
      return n === null ? null : { v: 6, base: n, bits: groups.length * 16 };
    }
    const octets = pre.split('.');
    if (octets.length < 1 || octets.length > 3 || octets.some((o) => !/^\d{1,3}$/.test(o) || Number(o) > 255)) return null;
    const padded = [...octets, ...new Array<string>(4 - octets.length).fill('0')].join('.');
    const n = parseV4(padded);
    return n === null ? null : { v: 4, base: n, bits: octets.length * 8 };
  }

  if (s.includes('/')) {
    const [addr, bitsStr] = s.split('/');
    const ip = parseIp(addr);
    const bits = Number(bitsStr);
    if (!ip || !Number.isInteger(bits)) return null;
    if (ip.v === 4 && (bits < 8 || bits > 32)) return null;
    if (ip.v === 6 && (bits < 32 || bits > 128)) return null;
    return { v: ip.v, base: ip.n, bits };
  }

  const ip = parseIp(s);
  if (!ip) return null;
  return { v: ip.v, base: ip.n, bits: ip.v === 4 ? 32 : 64 };
}

export function doesIpMatchRule(clientIp: string, ruleIp: string): boolean {
  const c = parseIp(clientIp);
  const r = parseRule(ruleIp);
  if (!c || !r || c.v !== r.v) return false;
  const total = r.v === 4 ? 32 : 128;
  const shift = BigInt(total - r.bits);
  return c.n >> shift === r.base >> shift;
}

/** Describes how wide a rule is, so the admin screen can warn before it lets other customers in. */
export function describeIpRule(ruleIp: string): { valid: boolean; level: "exact" | "small" | "block" | "broad" | "invalid"; family: 4 | 6 | null; bits: number; note: string } {
  const r = parseRule(ruleIp);
  if (!r) return { valid: false, level: 'invalid', family: null, bits: 0, note: 'Not a valid IP address or range' };
  if (r.v === 4) {
    if (r.bits === 32) return { valid: true, level: 'exact', family: 4, bits: r.bits, note: 'Exactly one IPv4 address' };
    const count = Math.pow(2, 32 - r.bits);
    if (r.bits >= 28) return { valid: true, level: 'small', family: 4, bits: r.bits, note: `${count} addresses` };
    if (r.bits >= 24) {
      return {
        valid: true,
        level: 'block',
        family: 4,
        bits: r.bits,
        note: `${count.toLocaleString('en-US')} addresses in your internet company's block (follows the office when the router reconnects)`,
      };
    }
    return {
      valid: true,
      level: 'broad',
      family: 4,
      bits: r.bits,
      note: `${count.toLocaleString('en-US')} addresses - many other customers of your internet company are included`,
    };
  }
  if (r.bits >= 64) return { valid: true, level: 'exact', family: 6, bits: r.bits, note: 'Your office IPv6 network (one LAN)' };
  if (r.bits >= 56) return { valid: true, level: 'small', family: 6, bits: r.bits, note: 'A small IPv6 block' };
  return { valid: true, level: 'broad', family: 6, bits: r.bits, note: 'A very large IPv6 block - other customers may be included' };
}


/**
 * The rule to store for a detected address. IPv6 becomes its /64 office network.
 * IPv4 is the exact address, or (wide = true) the 256-address block it sits in, because the internet
 * company hands out a different last number each time the office router reconnects.
 */
export function toNetworkRule(ip: string, wide = false): string | null {
  const parsed = parseIp(ip);
  if (!parsed) return null;
  if (parsed.v === 4) {
    const n = parsed.n;
    const octets = [24, 16, 8, 0].map((sh) => Number((n >> BigInt(sh)) & BigInt(255)));
    return wide ? `${octets[0]}.${octets[1]}.${octets[2]}.*` : octets.join('.');
  }
  const groups: string[] = [];
  for (let i = 7; i >= 4; i--) groups.push(((parsed.n >> BigInt(i * 16)) & BigInt(0xffff)).toString(16));
  return `${groups.join(':')}::/64`;
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
  let serverSeenIp: string | undefined;

  // 1. Query origin /api/my-ip (zero rate limits, fast, same origin)
  const myIpPromise = (async () => {
    try {
      const res = await fetch('/api/my-ip', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (data && typeof data.ip === 'string' && data.ip.trim()) {
          const ipStr = data.ip.trim();
          serverSeenIp = ipStr;
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

  // 4. IPv6-only endpoint: succeeds only when this network really has IPv6
  const ipifyV6Promise = (async () => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3500);
      const res = await fetch('https://api6.ipify.org?format=json', {
        signal: controller.signal,
        cache: 'no-store',
      });
      clearTimeout(timeout);
      if (res.ok) {
        const data = await res.json();
        if (data && typeof data.ip === 'string' && data.ip.includes(':')) {
          detectedIpv6 = data.ip.trim();
        }
      }
    } catch {}
  })();

  await Promise.allSettled([myIpPromise, ipwhoPromise, ipifyV4Promise, ipifyV6Promise]);

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
    serverSeenIp,
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
 * Evaluates whether the current user is on the office network (IPv4 and/or IPv6).
 * The internet company (ISP) is shown for information only and NEVER grants access.
 * The server repeats this check on every punch, so this is the friendly early warning.
 */
export function verifyOfficeIpAccess(
  clientIp: string,
  settings: OfficeSettings,
  user?: Employee | null,
  _clientIsp?: string,
  alternateIp?: string
): {
  allowed: boolean;
  reason?: string;
  matchedLabel?: string;
  /** true = allowed only because of the Work From Home permission (not on the office network). */
  remote?: boolean;
} {
  if (!settings.enforceOfficeIpLock) {
    return { allowed: true, matchedLabel: 'IP Lock Disabled' };
  }

  const rules = settings.allowedOfficeIps || [];
  const candidates = Array.from(
    new Set(
      [clientIp, alternateIp].filter(
        (ip): ip is string => Boolean(ip && ip !== 'Unknown' && ip !== 'Detecting...' && parseIp(ip))
      )
    )
  );

  if (user?.allowWorkFromHome) {
    const onOffice = rules.some((rule) => candidates.some((ip) => doesIpMatchRule(ip, rule.ip)));
    return onOffice
      ? { allowed: true, matchedLabel: 'Office network' }
      : { allowed: true, remote: true, matchedLabel: 'Work From Home (not on office network)' };
  }

  if (user?.role === 'admin' && (settings.allowAdminBypassIpLock ?? true)) {
    return { allowed: true, matchedLabel: 'Admin Remote Bypass' };
  }

  if (rules.length === 0) {
    return {
      allowed: false,
      reason:
        'No office network has been registered yet. Ask the administrator to open Office Settings on the office Wi-Fi and press "Capture this network".',
    };
  }

  for (const rule of rules) {
    for (const ip of candidates) {
      if (doesIpMatchRule(ip, rule.ip)) {
        return { allowed: true, matchedLabel: rule.label || `Office network (${rule.ip})` };
      }
    }
  }

  return {
    allowed: false,
    reason: `You are not on the office network (your IP: ${candidates.join(' / ') || 'unknown'}). Connect to the office Wi-Fi or LAN cable and try again.`,
  };
}
