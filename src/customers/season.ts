const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** True when a "Best season" text such as "Apr – Jun & Sep – Feb" covers the given month (0 = January). */
export function inSeason(bestSeason: string, month: number): boolean {
  const text = bestSeason.toLowerCase();
  if (/year-?round/.test(text) && !/[a-z]{3}\s*[–-]\s*[a-z]{3}/.test(text)) return true;
  const re = /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*[–-]\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const from = MONTHS.indexOf(m[1]); const to = MONTHS.indexOf(m[2]);
    if (from <= to ? month >= from && month <= to : month >= from || month <= to) return true;
  }
  return false;
}
