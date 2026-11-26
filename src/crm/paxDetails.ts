/**
 * Optional travel details on an invoice line (the "2 adults · 0 children · 1 room" style picker):
 * how many adults / children / infants, an optional price for each, and check-in / check-out (or travel) dates.
 * Everything is optional; empty or zero values are left out and never printed.
 */
export interface LinePax {
  adults?: number;
  children?: number;
  infants?: number;
  adultPrice?: number;
  childPrice?: number;
  infantPrice?: number;
  /** YYYY-MM-DD */
  from?: string;
  to?: string;
}

export const PAX_ROWS = [
  { key: 'adults', price: 'adultPrice', one: 'Adult', many: 'Adults', hint: '12+ years' },
  { key: 'children', price: 'childPrice', one: 'Child', many: 'Children', hint: '2–11 years' },
  { key: 'infants', price: 'infantPrice', one: 'Infant', many: 'Infants', hint: 'under 2' },
] as const;

const pos = (n: unknown): number => { const v = Number(n); return Number.isFinite(v) && v > 0 ? v : 0; };

/** Drops empty values; returns undefined when nothing is left. */
export function cleanLinePax(p?: LinePax | null): LinePax | undefined {
  if (!p) return undefined;
  const out: LinePax = {};
  for (const r of PAX_ROWS) {
    const n = Math.round(pos(p[r.key]));
    if (n) out[r.key] = Math.min(n, 999);
    const pr = pos(p[r.price]);
    if (pr) out[r.price] = Math.round(pr * 100) / 100;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(p.from || '')) out.from = p.from;
  if (/^\d{4}-\d{2}-\d{2}$/.test(p.to || '') && (!out.from || (p.to as string) >= out.from)) out.to = p.to;
  return Object.keys(out).length ? out : undefined;
}

export function nightsBetween(from?: string, to?: string): number {
  if (!from || !to) return 0;
  const d = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000;
  return Number.isFinite(d) && d > 0 ? Math.round(d) : 0;
}

/** Hotels and stays get "Check-in / Check-out"; everything else "From / To". */
export const isStay = (text: string): boolean => /hotel|stay|room|resort|accommodation|apartment|villa|night/i.test(text || '');

const day = (ymd: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m[2]) - 1];
  return `${m[3]} ${mon} ${m[1]}`;
};

/**
 * When prices are given per person, the line's own price follows them:
 *  - one kind of traveller priced → Units = how many, Unit price = their price (e.g. 3 × visa fee)
 *  - several kinds priced → Units = 1, Unit price = the total of all of them
 * Without any per-person price the line keeps the price typed by hand.
 */
export function paxPricing(p?: LinePax | null): { unitPrice: number; units: number } | null {
  if (!p) return null;
  const priced = PAX_ROWS.filter((r) => pos(p[r.key]) && pos(p[r.price]));
  if (!priced.length) return null;
  if (priced.length === 1) return { unitPrice: pos(p[priced[0].price]), units: Math.round(pos(p[priced[0].key])) };
  const total = priced.reduce((a, r) => a + Math.round(pos(p[r.key])) * pos(p[r.price]), 0);
  return { unitPrice: Math.round(total * 100) / 100, units: 1 };
}

/** Short summary for the picker button, e.g. "2 adults · 1 child · 17 Dec → 21 Dec (4 nights)". */
export function paxShort(p?: LinePax | null): string {
  if (!p) return '';
  const parts = PAX_ROWS.filter((r) => pos(p[r.key])).map((r) => `${p[r.key]} ${(p[r.key] === 1 ? r.one : r.many).toLowerCase()}`);
  if (p.from || p.to) {
    const n = nightsBetween(p.from, p.to);
    parts.push(`${p.from ? day(p.from).slice(0, 6) : '…'} → ${p.to ? day(p.to).slice(0, 6) : '…'}${n ? ` (${n} night${n === 1 ? '' : 's'})` : ''}`);
  }
  return parts.join(' · ');
}

/** The line printed under the description on the invoice / PDF. Empty values are skipped. */
export function paxText(p: LinePax | null | undefined, currency: string, money: (n: number) => string, stay: boolean): string {
  if (!p) return '';
  const parts: string[] = PAX_ROWS.filter((r) => pos(p[r.key])).map((r) => {
    const n = Number(p[r.key]);
    const price = pos(p[r.price]);
    return `${n} ${n === 1 ? r.one : r.many}${price ? ` × ${currency} ${money(price)}` : ''}`;
  });
  if (p.from || p.to) {
    const n = nightsBetween(p.from, p.to);
    const a = stay ? 'Check-in' : 'From';
    const b = stay ? 'Check-out' : 'To';
    parts.push([p.from ? `${a} ${day(p.from)}` : '', p.to ? `${b} ${day(p.to)}` : ''].filter(Boolean).join(' – ') + (n && stay ? ` (${n} night${n === 1 ? '' : 's'})` : ''));
  }
  return parts.join(' · ');
}
