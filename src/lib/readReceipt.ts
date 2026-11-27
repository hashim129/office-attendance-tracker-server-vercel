/**
 * Reads the amount (and transaction ID) from a bank-transfer screenshot, in the browser.
 * The text reader (Tesseract) is loaded only when someone taps "Read amount", so the app stays light.
 */
let loading: Promise<any> | null = null;
function loadReader(): Promise<any> {
  if ((window as any).Tesseract) return Promise.resolve((window as any).Tesseract);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    s.async = true;
    s.onload = () => resolve((window as any).Tesseract);
    s.onerror = () => { loading = null; reject(new Error('Could not load the text reader. Check your internet connection.')); };
    document.head.appendChild(s);
  });
  return loading;
}

const toNum = (v: string) => Number(v.replace(/,/g, ''));

/** Picks the amount from the text: a number on a line that mentions amount / total / Rs / PKR, otherwise the largest. */
export function pickFromText(text: string): { amount: number | null; reference: string | null } {
  const lines = text.split(/\n+/);
  const numRe = /(?:^|[^\d.])(\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d{3,9}(?:\.\d{1,2})?)(?![\d])/g;
  const key = /(amount|total|transferred|transfer|sent|paid|rs\.?|pkr|aed|usd|sar)/i;
  const idLike = /(tid|trx|transaction|ref|iban|account|a\/c|acc|phone|mobile|cnic|date|time|\d{1,2}[:/-]\d{1,2})/i;
  let best: number | null = null;
  for (const line of lines) {
    if (!key.test(line) || idLike.test(line.replace(key, ''))) continue;
    for (const m of line.matchAll(numRe)) { const n = toNum(m[1]); if (n >= 10 && n < 1e9 && (best === null || n > best)) best = n; }
    if (best !== null) break;
  }
  if (best === null) {
    for (const line of lines) {
      if (idLike.test(line)) continue;
      for (const m of line.matchAll(numRe)) { const n = toNum(m[1]); if (m[1].includes(',') && n >= 10 && n < 1e9 && (best === null || n > best)) best = n; }
    }
  }
  const ref = /(?:tid|trx\s*id|transaction\s*(?:id|no|#)?|ref(?:erence)?\s*(?:no|#|id)?)\s*[:#.-]?\s*([A-Z0-9]{6,24})/i.exec(text);
  return { amount: best, reference: ref ? ref[1] : null };
}

export async function readReceiptImage(dataUrl: string): Promise<{ amount: number | null; reference: string | null }> {
  const T = await loadReader();
  const r = await T.recognize(dataUrl, 'eng');
  return pickFromText(String(r?.data?.text || ''));
}
