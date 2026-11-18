export interface CurrencyInfo { code: string; name: string }

// Used only if the browser cannot list currencies itself (very old browsers).
const FALLBACK = 'AED AFN ALL AMD ARS AUD AZN BAM BDT BGN BHD BRL BWP BYN CAD CHF CLP CNY COP CZK DKK DZD EGP ETB EUR GBP GEL GHS HKD HUF IDR ILS INR IQD IRR ISK JOD JPY KES KGS KHR KRW KWD KZT LBP LKR MAD MDL MMK MNT MUR MVR MXN MYR NGN NOK NPR NZD OMR PEN PHP PKR PLN QAR RON RSD RUB SAR SEK SGD THB TJS TND TRY TWD TZS UAH UGX USD UZS VND XAF XOF ZAR ZMW'.split(' ');
const TOP = ['PKR', 'USD', 'AED', 'SAR', 'EUR', 'GBP', 'QAR', 'TRY', 'AZN', 'MYR', 'THB'];

let cache: CurrencyInfo[] | null = null;

/** Every ISO-4217 currency the browser knows (about 160), with its English name. Common ones come first. */
export function allCurrencies(): CurrencyInfo[] {
  if (cache) return cache;
  let codes: string[] = [];
  try {
    codes = (Intl as any).supportedValuesOf ? (Intl as any).supportedValuesOf('currency') : [];
  } catch {
    codes = [];
  }
  if (codes.length < 20) codes = FALLBACK;
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames(['en'], { type: 'currency' });
  } catch {
    names = null;
  }
  const list = Array.from(new Set([...TOP, ...codes])).map((code) => {
    let name = code;
    try {
      name = (names && names.of(code)) || code;
    } catch {
      name = code;
    }
    return { code, name };
  });
  const rest = list.filter((c) => !TOP.includes(c.code)).sort((a, b) => a.name.localeCompare(b.name));
  cache = [...TOP.map((c) => list.find((x) => x.code === c)!), ...rest];
  return cache;
}

export const currencyLabel = (c: CurrencyInfo) => `${c.code} — ${c.name}`;

/** 629290 -> "629,290"; 219592.6 -> "219,592.60". Whole numbers show no decimals. */
export function fmtAmount(n: number): string {
  const whole = Math.abs(n - Math.round(n)) < 0.005;
  return n.toLocaleString('en-US', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
}
