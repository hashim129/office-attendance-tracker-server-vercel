import { PDFDocument, PDFFont, PDFPage, StandardFonts, degrees, rgb } from 'pdf-lib';
import { CompanyProfile, CrmInvoice } from './crmApi';
import { fmtAmount } from './currencies';

const A4: [number, number] = [595.28, 841.89];
const M = 40; // page margin
const COLS = [28, 235, 85, 50, 117]; // SN, description, unit price, units, amount (sum = 515)
const GREY = rgb(0.85, 0.85, 0.85);
const INK = rgb(0.07, 0.07, 0.1);
const SOFT = rgb(0.4, 0.42, 0.47);
const LINE = rgb(0.2, 0.2, 0.25);
const BLUE = rgb(0.06, 0.2, 0.55);

const niceDate = (iso: string | null): string => {
  if (!iso) return '';
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  const mon = d.toLocaleDateString('en-GB', { month: 'short' });
  return `${String(d.getDate()).padStart(2, '0')}-${mon}-${String(d.getFullYear()).slice(2)}`;
};

/** Standard PDF fonts only know Western characters; anything else (emoji, Urdu…) is shown as "?" instead of crashing. */
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
      // break very long words
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

/** Builds the invoice as a PDF (A4). Works fully in the browser; nothing is uploaded anywhere. */
export async function buildInvoicePdf(inv: CrmInvoice, company: CompanyProfile, preparedBy: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Invoice ${inv.invoiceNo}`);
  pdf.setAuthor(company.name || 'Invoice');
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const serif = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const logo = await loadLogo(pdf);
  const W = A4[0] - M * 2;
  const cur = inv.currency;

  let page: PDFPage = pdf.addPage(A4);
  let y = A4[1] - M;

  const text = (t: string, x: number, yy: number, size = 9, font: PDFFont = reg, color = INK) =>
    page.drawText(safe(font, t), { x, y: yy, size, font, color });
  const right = (t: string, xr: number, yy: number, size = 9, font: PDFFont = reg, color = INK) =>
    page.drawText(safe(font, t), { x: xr - font.widthOfTextAtSize(safe(font, t), size), y: yy, size, font, color });
  const center = (t: string, xc: number, yy: number, size = 9, font: PDFFont = reg, color = INK) =>
    page.drawText(safe(font, t), { x: xc - font.widthOfTextAtSize(safe(font, t), size) / 2, y: yy, size, font, color });
  const hline = (x1: number, x2: number, yy: number, t = 0.7) => page.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness: t, color: LINE });
  const colX = (i: number) => M + COLS.slice(0, i).reduce((a, b) => a + b, 0);

  // ----- header: logo + company contact on the left, meta table on the right
  const logoW = 215;
  let leftBottom = y;
  if (logo) {
    const h = (logo.height / logo.width) * logoW;
    page.drawImage(logo, { x: M - 4, y: y - h, width: logoW, height: h });
    leftBottom = y - h;
  } else {
    text(company.name || 'Company', M, y - 16, 18, bold, BLUE);
    leftBottom = y - 24;
  }
  let cy = leftBottom - 12;
  for (const line of [company.address, [company.phone, company.email].filter(Boolean).join('   |   '), company.website]) {
    if (!line) continue;
    for (const l of wrap(reg, line, 8, 260)) { text(l, M, cy, 8, reg, SOFT); cy -= 10.5; }
  }

  const metaX = A4[0] - M - 190;
  const meta: [string, string][] = [['Invoice No', inv.invoiceNo], ['Invoice Date', niceDate(inv.invoiceDate)]];
  if (inv.dueDate) meta.push(['Due Date', niceDate(inv.dueDate)]);
  if (company.ntn) meta.push(['NTN#', company.ntn]);
  if (inv.reference) meta.push(['Reference', inv.reference]);
  let my = y - 6;
  for (const [k, v] of meta) {
    page.drawRectangle({ x: metaX, y: my - 16, width: 190, height: 16, borderColor: LINE, borderWidth: 0.7 });
    page.drawLine({ start: { x: metaX + 70, y: my }, end: { x: metaX + 70, y: my - 16 }, thickness: 0.7, color: LINE });
    text(k, metaX + 4, my - 11.5, 8.5, reg);
    center(wrap(bold, v, 9, 112)[0], metaX + 70 + 60, my - 11.5, 9, bold);
    my -= 16;
  }

  y = Math.min(cy, my) - 14;

  // ----- bill to
  text('BILL TO', M, y, 7.5, bold, SOFT);
  y -= 12;
  text(wrap(bold, inv.customerName, 11, 300)[0], M, y, 11, bold);
  y -= 13;
  for (const l of [inv.customerPhone && `Phone: ${inv.customerPhone}`, inv.customerAddress, inv.customerNtn && `NTN: ${inv.customerNtn}`].filter(Boolean) as string[]) {
    for (const w of wrap(reg, l, 9, 300)) { text(w, M, y, 9, reg); y -= 11.5; }
  }

  y -= 12;
  center('INVOICE', A4[0] / 2, y, 20, serif);
  y -= 12;

  // ----- items table
  const ROW = 15;
  let tableTop = y;
  let tableOpen = true;
  const drawHeader = () => {
    page.drawRectangle({ x: M, y: y - 18, width: W, height: 18, borderColor: LINE, borderWidth: 0.9 });
    center('SN', colX(0) + COLS[0] / 2, y - 12.5, 8.5, bold);
    center('DESCRIPTION', colX(1) + COLS[1] / 2, y - 12.5, 8.5, bold);
    center('UNIT PRICE', colX(2) + COLS[2] / 2, y - 12.5, 8.5, bold);
    center('UNITS', colX(3) + COLS[3] / 2, y - 12.5, 8.5, bold);
    center(`AMOUNT ${cur}`, colX(4) + COLS[4] / 2, y - 12.5, 8.5, bold);
    y -= 18;
    tableTop = y + 18;
  };
  const closeTable = () => {
    if (!tableOpen) return;
    tableOpen = false;
    // outer frame and column dividers for the rows drawn on this page
    page.drawRectangle({ x: M, y, width: W, height: tableTop - y, borderColor: LINE, borderWidth: 0.9 });
    for (let i = 1; i < COLS.length; i++) page.drawLine({ start: { x: colX(i), y: tableTop }, end: { x: colX(i), y }, thickness: 0.7, color: LINE });
  };
  const newPage = () => {
    const continuing = tableOpen;
    closeTable();
    page = pdf.addPage(A4);
    y = A4[1] - M;
    if (continuing) {
      tableOpen = true;
      drawHeader();
    }
  };
  const ensure = (h: number) => { if (y - h < M + 40) newPage(); };
  drawHeader();

  let sn = 0;
  for (const sec of inv.sections) {
    if (sec.title) {
      sn++;
      ensure(ROW * 2);
      page.drawRectangle({ x: colX(1), y: y - ROW, width: W - COLS[0], height: ROW, color: GREY });
      center(String(sn), colX(0) + COLS[0] / 2, y - 10.5, 9, reg);
      text(wrap(bold, sec.title, 9, COLS[1] + COLS[2] + COLS[3] + COLS[4] - 10)[0], colX(1) + 4, y - 10.5, 9, bold);
      y -= ROW;
    }
    for (const l of sec.lines) {
      const descLines = wrap(l.note ? bold : reg, l.description, 9, COLS[1] - 10);
      const foreign = !l.note && (l.currency || cur) !== cur && Boolean(l.rate);
      const h = Math.max(foreign ? ROW + 8 : ROW, descLines.length * 11 + 4);
      ensure(h);
      descLines.forEach((dl, i) => text(dl, colX(1) + 4, y - 10.5 - i * 11, 9, l.note ? bold : reg));
      if (!l.note) {
        center(`${l.currency || cur} ${fmtAmount(l.unitPrice || 0)}`, colX(2) + COLS[2] / 2, y - 10.5, 9, reg);
        center(fmtAmount(l.units ?? 1), colX(3) + COLS[3] / 2, y - 10.5, 9, reg);
        right(fmtAmount(l.amount || 0), colX(4) + COLS[4] - 6, y - 10.5, 9, reg);
        if (foreign) center(`1 ${l.currency} = ${fmtAmount(l.rate || 0)} ${cur}`, colX(2) + COLS[2] / 2, y - 19.5, 6.5, reg, SOFT);
      }
      y -= h;
    }
    y -= 4;
  }

  // ----- totals inside the same table
  const amountRight = colX(4) + COLS[4] - 6;
  if (inv.taxAmount > 0) {
    ensure(ROW + 2);
    text(`${inv.taxLabel || 'TAX'}${inv.taxRate ? ` (${fmtAmount(inv.taxRate)}%)` : ''}`.toUpperCase(), colX(1) + 4, y - 10.5, 9, bold);
    right(fmtAmount(inv.taxAmount), amountRight, y - 10.5, 9, reg);
    y -= ROW;
  }
  if (inv.discount > 0) {
    ensure(ROW + 2);
    text('DISCOUNT', colX(1) + 4, y - 10.5, 9, bold);
    right(`-${fmtAmount(inv.discount)}`, amountRight, y - 10.5, 9, reg);
    y -= ROW;
  }
  y -= 4;
  closeTable();
  y -= 2;

  // Total / advance / balance boxes (like the sample: Total row, then Balance row)
  const boxRow = (label: string, value: string, strong: boolean) => {
    ensure(20);
    page.drawRectangle({ x: M, y: y - 17, width: W, height: 17, borderColor: LINE, borderWidth: 0.9 });
    page.drawLine({ start: { x: colX(4), y }, end: { x: colX(4), y: y - 17 }, thickness: 0.7, color: LINE });
    right(label, colX(4) - 8, y - 12, 9.5, bold);
    right(value, amountRight, y - 12, 9.5, strong ? bold : reg);
    y -= 17;
  };
  boxRow('Total', fmtAmount(inv.total), true);
  if (inv.advancePaid > 0) boxRow('Advance received', `-${fmtAmount(inv.advancePaid)}`, false);
  boxRow('Balance', `${cur} ${fmtAmount(inv.balance)}`, true);

  // ----- payment instructions, bank details, notes
  y -= 16;
  ensure(60);
  const payTo = company.payTo || company.name;
  if (payTo && inv.status !== 'paid') {
    const prefix = 'KINDLY MAKE CHEQUE OF ';
    const amt = `${cur} ${fmtAmount(inv.balance)}/-`;
    const rest = ` IN FAVOR OF ${payTo.toUpperCase()}`;
    const full = `${prefix}${amt}${rest}`;
    const lines = wrap(reg, full, 9, W);
    if (lines.length === 1) {
      let x = M;
      text(prefix, x, y, 9, reg); x += reg.widthOfTextAtSize(safe(reg, prefix), 9) + 2;
      text(amt, x, y, 9, bold); x += bold.widthOfTextAtSize(safe(bold, amt), 9) + 1;
      text(rest, x, y, 9, reg);
      y -= 13;
    } else {
      for (const l of lines) { text(l, M, y, 9, reg); y -= 12; }
    }
  }
  if (company.bankDetails) {
    ensure(40);
    y -= 6;
    text('BANK DETAILS', M, y, 8, bold, SOFT); y -= 11;
    for (const l of wrap(reg, company.bankDetails, 9, W)) { ensure(14); text(l, M, y, 9, reg); y -= 11.5; }
  }
  const notes = [inv.notes, company.terms].filter(Boolean).join('\n');
  if (notes) {
    ensure(40);
    y -= 8;
    text('NOTES & TERMS', M, y, 8, bold, SOFT); y -= 11;
    for (const l of wrap(reg, notes, 8.5, W)) { ensure(14); text(l, M, y, 8.5, reg, SOFT); y -= 11; }
  }

  // ----- footer
  ensure(70);
  y -= 22;
  if (company.footer) text(company.footer, M, y, 10, bold);
  hline(A4[0] - M - 150, A4[0] - M, y - 2, 0.6);
  center('Authorised signature', A4[0] - M - 75, y - 12, 8, reg, SOFT);
  if (preparedBy) text(`Prepared by ${preparedBy}`, M, y - 14, 7.5, reg, SOFT);

  // ----- stamp
  if (inv.status === 'paid' || inv.status === 'cancelled') {
    const paid = inv.status === 'paid';
    const label = paid ? 'PAID' : 'CANCELLED';
    const color = paid ? rgb(0.05, 0.55, 0.3) : rgb(0.8, 0.1, 0.1);
    for (const p of pdf.getPages()) {
      p.drawText(label, { x: 150, y: 330, size: 78, font: bold, color, rotate: degrees(30), opacity: 0.16 });
    }
  }

  // page numbers
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    const t = `${inv.invoiceNo}  ·  Page ${i + 1} of ${pages.length}`;
    p.drawText(t, { x: A4[0] / 2 - reg.widthOfTextAtSize(t, 7) / 2, y: 20, size: 7, font: reg, color: SOFT });
  });

  return pdf.save();
}

export const invoiceFileName = (inv: CrmInvoice) => `${inv.invoiceNo}-${inv.customerName.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'invoice'}.pdf`;

export async function invoicePdfFile(inv: CrmInvoice, company: CompanyProfile, preparedBy: string): Promise<File> {
  const bytes = await buildInvoicePdf(inv, company, preparedBy);
  return new File([bytes], invoiceFileName(inv), { type: 'application/pdf' });
}

export async function downloadInvoicePdf(inv: CrmInvoice, company: CompanyProfile, preparedBy: string): Promise<void> {
  const file = await invoicePdfFile(inv, company, preparedBy);
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}
