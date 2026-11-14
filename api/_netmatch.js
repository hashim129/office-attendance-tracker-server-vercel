/**
 * Exact office-network matching (IPv4 + IPv6).
 *
 * The office is identified ONLY by its public IP addresses. An internet company (ISP) name
 * is never used to grant access, because every customer of that company shares the name.
 *
 * Supported rules
 *   1.2.3.4            exact IPv4
 *   1.2.3.0/28         IPv4 block (any size from /8 to /32)
 *   1.2.3.*  1.2.*     IPv4 wildcard (octet aligned = /24, /16)
 *   2400:ab:1:2::1     a bare IPv6 address means its whole /64 (one home/office LAN), because
 *                      phones and laptops rotate the last 64 bits (privacy addresses)
 *   2400:ab:1:2::/64   IPv6 block (any size from /32 to /128)
 *   2400:ab:1:2:*      IPv6 wildcard (groups given = prefix)
 * (This file is mirrored in src/lib/ipSecurity.ts - keep the two in sync.)
 */

const ZERO = BigInt(0);
const ONE = BigInt(1);

function parseV4(s) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  let n = ZERO;
  for (let i = 1; i <= 4; i++) {
    const o = Number(m[i]);
    if (o > 255) return null;
    n = (n << BigInt(8)) | BigInt(o);
  }
  return n;
}

function parseV6(s) {
  let str = s;
  let tailV4 = null;
  const lastColon = str.lastIndexOf(':');
  if (str.includes('.') && lastColon >= 0) {
    tailV4 = parseV4(str.slice(lastColon + 1));
    if (tailV4 === null) return null;
    str = str.slice(0, lastColon + 1) + '0:0';
  }
  const halves = str.split('::');
  if (halves.length > 2) return null;
  const toGroups = (h) => (h === '' ? [] : h.split(':'));
  const left = toGroups(halves[0]);
  const right = halves.length === 2 ? toGroups(halves[1]) : [];
  const missing = 8 - left.length - right.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...left, ...new Array(halves.length === 2 ? missing : 0).fill('0'), ...right];
  if (groups.length !== 8) return null;
  let n = ZERO;
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    n = (n << BigInt(16)) | BigInt(parseInt(g, 16));
  }
  if (tailV4 !== null) n = (n & ~BigInt(0xffffffff)) | tailV4;
  return n;
}

/** -> { v: 4 | 6, n: bigint } or null */
export function parseIp(raw) {
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
export function parseRule(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return null;

  if (s.includes('*')) {
    const pre = s.split('*')[0].replace(/[.:]+$/, '');
    if (!pre) return null;
    if (pre.includes(':')) {
      const groups = pre.split(':').filter((g) => g !== '');
      if (groups.length < 2 || groups.length > 7 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
      const n = parseV6(groups.join(':') + new Array(8 - groups.length).fill(':0').join(''));
      return n === null ? null : { v: 6, base: n, bits: groups.length * 16 };
    }
    const octets = pre.split('.');
    if (octets.length < 1 || octets.length > 3 || octets.some((o) => !/^\d{1,3}$/.test(o) || Number(o) > 255)) return null;
    const padded = [...octets, ...new Array(4 - octets.length).fill('0')].join('.');
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

export function doesIpMatchRule(clientIp, ruleIp) {
  const c = parseIp(clientIp);
  const r = parseRule(ruleIp);
  if (!c || !r || c.v !== r.v) return false;
  const total = r.v === 4 ? 32 : 128;
  const shift = BigInt(total - r.bits);
  return c.n >> shift === r.base >> shift;
}

/** Describes how wide a rule is, so the admin screen can warn before it lets other customers in. */
export function describeIpRule(ruleIp) {
  const r = parseRule(ruleIp);
  if (!r) return { valid: false, level: 'invalid', family: null, bits: 0, note: 'Not a valid IP address or range' };
  if (r.v === 4) {
    if (r.bits === 32) return { valid: true, level: 'exact', family: 4, bits: r.bits, note: 'Exactly one IPv4 address' };
    const count = Math.pow(2, 32 - r.bits);
    if (r.bits >= 28) return { valid: true, level: 'small', family: 4, bits: r.bits, note: `${count} addresses` };
    return {
      valid: true,
      level: 'broad',
      family: 4,
      bits: r.bits,
      note: `${count.toLocaleString('en-US')} addresses - other customers of your internet company are included`,
    };
  }
  if (r.bits >= 64) return { valid: true, level: 'exact', family: 6, bits: r.bits, note: 'Your office IPv6 network (one LAN)' };
  if (r.bits >= 56) return { valid: true, level: 'small', family: 6, bits: r.bits, note: 'A small IPv6 block' };
  return { valid: true, level: 'broad', family: 6, bits: r.bits, note: 'A very large IPv6 block - other customers may be included' };
}

/**
 * Decides whether a punch from these IPs is allowed.
 * ips = every address we can see for this request (server-seen first).
 */
export function checkOfficeNetwork({ settings, employee, ips }) {
  const s = settings || {};
  if (!s.enforceOfficeIpLock) return { allowed: true, matchedLabel: 'IP lock is off' };
  if (employee && employee.allowWorkFromHome) return { allowed: true, matchedLabel: 'Work from home allowed' };

  const rules = Array.isArray(s.allowedOfficeIps) ? s.allowedOfficeIps : [];
  const candidates = Array.from(new Set((ips || []).filter((x) => parseIp(x))));

  if (rules.length === 0) {
    return {
      allowed: false,
      code: 'NO_OFFICE_NETWORK',
      reason: 'No office network has been registered yet. Ask the administrator to open Office Settings on the office Wi-Fi and press "Capture this network".',
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
    code: 'OUTSIDE_OFFICE_NETWORK',
    reason: `You are not on the office network (your IP: ${candidates.join(' / ') || 'unknown'}). Connect to the office Wi-Fi or LAN cable and try again.`,
  };
}
