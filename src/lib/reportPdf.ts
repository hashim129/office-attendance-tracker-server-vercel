import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib';

/**
 * One reusable maker for table-style PDF reports (invoices, purchases, sales, receipts, follow-ups, attendance...).
 * Works fully in the browser; nothing is uploaded anywhere.
 */
export interface PdfColumn {
  key: string;
  label: string;
  /** Relative width: columns share the page width in proportion to this number */
  width: number;
  align?: 'left' | 'right' | 'center';
}

export interface ReportSection {
  /** Heading printed above this table, e.g. "Receivables" */
  heading?: string;
  columns: PdfColumn[];
  rows: Record<string, string>[];
  totals?: Record<string, string> | null;
}

export interface ReportPdfOptions {
  title: string;
  /** What the report covers, e.g. "Created 01 Nov 2026 to 25 Nov 2026 - created by Faiq Ahmed" */
  subtitle?: string;
  companyName?: string;
  generatedBy?: string;
  columns: PdfColumn[];
  rows: Record<string, string>[];
  /** Optional last row, e.g. totals, keyed by column key */
  totals?: Record<string, string> | null;
  /** Several tables in one PDF (used instead of columns / rows) */
  sections?: ReportSection[];
  /** Short facts printed above the table, e.g. [['Invoices', '12'], ['Total PKR', '1,200,000']] */
  summary?: [string, string][];
  /** Wider page for tables with many columns (default: automatic) */
  landscape?: boolean;
}

const A4: [number, number] = [595.28, 841.89];
const INK = rgb(0.07, 0.07, 0.1);
const SOFT = rgb(0.4, 0.42, 0.47);
const LINE = rgb(0.8, 0.82, 0.86);
const HEAD = rgb(0.9, 0.92, 0.96);
const ZEBRA = rgb(0.972, 0.976, 0.985);
const BLUE = rgb(0.06, 0.2, 0.55);

/** Standard PDF fonts only know Western characters; anything else (emoji, Urdu...) is shown as "?" instead of crashing. */
const safe = (font: PDFFont, text: string): string => {
  const set = new Set(font.getCharacterSet());
  let out = '';
  for (const ch of String(text ?? '').replace(/[\r\t]/g, ' ')) {
    const cp = ch.codePointAt(0)!;
    out += ch === '\n' || set.has(cp) ? ch : '?';
  }
  return out;
};

const wrap = (font: PDFFont, text: string, size: number, width: number): string[] => {
  const lines: string[] = [];
  for (const para of safe(font, text).split('\n')) {
    let cur = '';
    for (const word of para.split(' ')) {
      let w = word;
      while (font.widthOfTextAtSize(w, size) > width && w.length > 1) {
        let cut = w.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(w.slice(0, cut), size) > width) cut--;
        if (cur) { lines.push(cur); cur = ''; }
        lines.push(w.slice(0, cut));
        w = w.slice(cut);
      }
      const next = cur ? `${cur} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) <= width) cur = next;
      else { if (cur) lines.push(cur); cur = w; }
    }
    lines.push(cur);
  }
  return lines.length ? lines : [''];
};

async function loadLogo(pdf: PDFDocument) {
  try {
    const res = await fetch('/bahaar-logo.png', { cache: 'force-cache' });
    if (!res.ok) return null;
    return await pdf.embedPng(new Uint8Array(await res.arrayBuffer()));
  } catch {
    return null;
  }
}

const TZ = 'Asia/Karachi';
/** 25 Nov 2026, 5:50 AM (Pakistan time) */
export const fmtDateTimePk = (iso?: string | null): string => {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-GB', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
};
/** 25 Nov 2026 (Pakistan time) */
export const fmtDatePk = (iso?: string | null): string => {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric' });
};
/** The day (YYYY-MM-DD, Pakistan time) of an ISO timestamp, used by the date filters */
export const dayPk = (iso?: string | null): string => {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
};
/** A date-only value (YYYY-MM-DD) shown as 25 Nov 2026 */
export const fmtDayText = (ymd?: string | null): string => {
  if (!ymd) return '';
  const d = new Date(`${String(ymd).slice(0, 10)}T12:00:00`);
  return Number.isNaN(d.getTime()) ? String(ymd) : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};
export const money = (n: number): string => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
export const safeFileName = (s: string): string => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'report';

export async function buildReportPdf(opts: ReportPdfOptions): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(opts.title);
  pdf.setAuthor(opts.companyName || 'Bahaar Journeys');
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await loadLogo(pdf);

  const sections: ReportSection[] = opts.sections?.length ? opts.sections : [{ columns: opts.columns, rows: opts.rows, totals: opts.totals }];
  const widest = Math.max(...sections.map((x) => x.columns.length));
  const landscape = opts.landscape ?? widest > 5;
  const size: [number, number] = landscape ? [A4[1], A4[0]] : A4;
  const M = 32;
  const W = size[0] - M * 2;
  const FS = 8;
  const LH = 10.5;
  const PAD = 3;

  let page: PDFPage = pdf.addPage(size);
  let y = size[1] - M;

  const drawText = (t: string, x: number, yy: number, s = FS, font: PDFFont = reg, color = INK) => page.drawText(safe(font, t), { x, y: yy, size: s, font, color });

  // ---- masthead
  if (logo) {
    const lw = 150;
    const lh = (logo.height / logo.width) * lw;
    page.drawImage(logo, { x: M - 2, y: y - lh, width: lw, height: lh });
  } else {
    drawText(opts.companyName || 'Bahaar Journeys', M, y - 14, 15, bold, BLUE);
  }
  const stamp = `Generated ${fmtDateTimePk(new Date().toISOString())}${opts.generatedBy ? ` by ${opts.generatedBy}` : ''}`;
  page.drawText(safe(reg, stamp), { x: size[0] - M - reg.widthOfTextAtSize(safe(reg, stamp), 7.5), y: y - 9, size: 7.5, font: reg, color: SOFT });
  y -= (logo ? (logo.height / logo.width) * 150 : 22) + 12;
  drawText(opts.title, M, y, 15, bold);
  y -= 15;
  if (opts.subtitle) {
    for (const l of wrap(reg, opts.subtitle, 9, W)) { drawText(l, M, y, 9, reg, SOFT); y -= 11.5; }
  }
  y -= 4;
  if (opts.summary?.length) {
    let x = M;
    for (const [k, v] of opts.summary) {
      const label = safe(reg, k.toUpperCase());
      const value = safe(bold, v);
      const w = Math.max(reg.widthOfTextAtSize(label, 6.5), bold.widthOfTextAtSize(value, 10)) + 18;
      if (x + w > size[0] - M) { x = M; y -= 32; }
      page.drawRectangle({ x, y: y - 24, width: w - 6, height: 28, color: HEAD });
      page.drawText(label, { x: x + 6, y: y - 7, size: 6.5, font: reg, color: SOFT });
      page.drawText(value, { x: x + 6, y: y - 20, size: 10, font: bold, color: INK });
      x += w;
    }
    y -= 36;
  }

  // ---- tables
  for (const sec of sections) {
    const cols = sec.columns;
    const totalW = cols.reduce((a, c) => a + c.width, 0) || 1;
    const cw = cols.map((c) => (c.width / totalW) * W);
    const colX = (i: number) => M + cw.slice(0, i).reduce((a, b) => a + b, 0);
    if (sec.heading) {
      if (y < M + 70) { page = pdf.addPage(size); y = size[1] - M; }
      y -= 6;
      drawText(sec.heading, M, y, 11.5, bold, BLUE);
      y -= 8;
    }
    const header = () => {
      page.drawRectangle({ x: M, y: y - 16, width: W, height: 16, color: HEAD });
      cols.forEach((c, i) => {
        const label = safe(bold, c.label.toUpperCase());
        const tw = bold.widthOfTextAtSize(label, 7);
        const x = c.align === 'right' ? colX(i) + cw[i] - PAD - tw : c.align === 'center' ? colX(i) + (cw[i] - tw) / 2 : colX(i) + PAD;
        page.drawText(label, { x, y: y - 11, size: 7, font: bold, color: INK });
      });
      y -= 16;
    };
    const newPage = () => {
      page = pdf.addPage(size);
      y = size[1] - M;
      header();
    };
    header();

    const drawRow = (cells: Record<string, string>, i: number, isTotal = false) => {
      const font = isTotal ? bold : reg;
      const lines = cols.map((c, ci) => wrap(font, cells[c.key] ?? '', FS, cw[ci] - PAD * 2));
      const rowH = Math.max(...lines.map((l) => l.length)) * LH + 5;
      if (y - rowH < M + 18) newPage();
      if (isTotal) page.drawRectangle({ x: M, y: y - rowH, width: W, height: rowH, color: HEAD });
      else if (i % 2 === 1) page.drawRectangle({ x: M, y: y - rowH, width: W, height: rowH, color: ZEBRA });
      cols.forEach((c, ci) => {
        lines[ci].forEach((l, li) => {
          const tw = font.widthOfTextAtSize(l, FS);
          const x = c.align === 'right' ? colX(ci) + cw[ci] - PAD - tw : c.align === 'center' ? colX(ci) + (cw[ci] - tw) / 2 : colX(ci) + PAD;
          page.drawText(l, { x, y: y - 9 - li * LH, size: FS, font, color: INK });
        });
      });
      y -= rowH;
      page.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness: 0.4, color: LINE });
    };

    if (!sec.rows.length) {
      drawText('Nothing matches these filters.', M + PAD, y - 14, 9, reg, SOFT);
      y -= 24;
    }
    sec.rows.forEach((r, i) => drawRow(r, i));
    if (sec.totals) drawRow(sec.totals, 0, true);
    y -= 12;
  }

  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    const t = `${opts.title}  -  Page ${i + 1} of ${pages.length}`;
    p.drawText(safe(reg, t), { x: size[0] / 2 - reg.widthOfTextAtSize(safe(reg, t), 7) / 2, y: 16, size: 7, font: reg, color: SOFT });
  });
  return pdf.save();
}

export async function downloadReportPdf(opts: ReportPdfOptions, filename: string): Promise<void> {
  const bytes = await buildReportPdf(opts);
  const file = new File([bytes], filename.endsWith('.pdf') ? filename : `${filename}.pdf`, { type: 'application/pdf' });
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}
