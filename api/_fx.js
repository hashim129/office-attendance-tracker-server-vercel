// Daily currency rates (to PKR) from open.er-api.com, cached once a day in crm_company 'fx-rates'.
import { supabaseFetch } from './_supabase.js';

const pktDay = () => new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10);
let mem = null;

/** { date, rates } where rates[CUR] = how many CUR for 1 PKR. Never throws: falls back to the last saved rates. */
export async function fxRates() {
  const today = pktDay();
  if (mem && mem.date === today) return mem;
  const row = (await supabaseFetch('/crm_company?id=eq.fx-rates&select=data').catch(() => null))?.[0];
  const saved = row?.data && row.data.rates ? row.data : null;
  if (saved && saved.date === today) { mem = saved; return saved; }
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 6000);
    const r = await fetch('https://open.er-api.com/v6/latest/PKR', { signal: ctl.signal });
    clearTimeout(t);
    const j = await r.json();
    if (j && j.result === 'success' && j.rates && j.rates.USD) {
      const next = { date: today, rates: j.rates, source: 'open.er-api.com' };
      await supabaseFetch('/crm_company', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify([{ id: 'fx-rates', data: next, updated_at: new Date().toISOString() }]) }).catch(() => null);
      mem = next; return next;
    }
  } catch { /* offline: use the saved rates */ }
  mem = saved || { date: null, rates: { PKR: 1 } };
  return mem;
}

/** Amount in PKR (null when the currency has no rate yet). */
export function toPkr(amount, currency, fx) {
  const n = Number(amount) || 0;
  if (!currency || currency === 'PKR') return n;
  const r = fx?.rates?.[currency];
  return r ? n / r : null;
}
