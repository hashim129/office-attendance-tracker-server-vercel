import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib';
import { CompanyProfile, CrmReceipt } from './crmApi';
import { fmtAmount } from './currencies';

const A4: [number, number] = [595.28, 841.89];
const M = 40;
const INK = rgb(0.07, 0.07, 0.1);
const SOFT = rgb(0.4, 0.42, 0.47);
const LINE = rgb(0.2, 0.2, 0.25);
const BLUE = rgb(0.06, 0.2, 0.55);
const TINT = rgb(0.9, 0.93, 0.98);

import { receiptItemsText } from './receiptText';
export { receiptItemsText };

const dateOf = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getDate()).padStart(2, '0')}-${d.toLocaleDateString('en-GB', { month: 'short' })}-${String(d.getFullYear()).slice(2)}`;
};

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

/** Builds the receipt as a one-page A4 PDF in the browser (same Bahaar Journeys logo, receipt layout). */
/** Printed at the foot of every receipt page. */
export const SYSTEM_LINE_RECEIPT = 'System Generated Receipt, stamps not required';

export async function buildReceiptPdf(r: CrmReceipt, company: CompanyProfile, receivedBy: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Receipt ${r.receiptNo}`);
  pdf.setAuthor(company.name || 'Receipt');
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const serif = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const logo = await loadLogo(pdf);
  const W = A4[0] - M * 2;
  const cur = r.currency;
  let page: PDFPage = pdf.addPage(A4);
  let y = A4[1] - M;

  const text = (t: string, x: number, yy: number, size = 9.5, font: PDFFont = reg, color = INK) => page.drawText(safe(font, t), { x, y: yy, size, font, color });
  const right = (t: string, xr: number, yy: number, size = 9.5, font: PDFFont = reg, color = INK) => page.drawText(safe(font, t), { x: xr - font.widthOfTextAtSize(safe(font, t), size), y: yy, size, font, color });
  const center = (t: string, xc: number, yy: number, size = 9.5, font: PDFFont = reg, color = INK) => page.drawText(safe(font, t), { x: xc - font.widthOfTextAtSize(safe(font, t), size) / 2, y: yy, size, font, color });
  const ensure = (h: number) => { if (y - h < M + 40) { page = pdf.addPage(A4); y = A4[1] - M; } };

  // ----- logo, then "RECEIVED FROM" on the left and the receipt details on the right
  const logoW = 380;
  if (logo) {
    const h = (logo.height / logo.width) * logoW;
    page.drawImage(logo, { x: M - 6, y: y - h, width: logoW, height: h });
    y -= h + 12;
  } else {
    text(company.name || 'Company', M, y - 22, 24, bold, BLUE);
    y -= 40;
  }

  const meta: [string, string][] = [['Receipt No', r.receiptNo], ['Date', dateOf(r.createdAt)], ['Query Code', r.queryCode]];
  const metaKeyW = 78;
  const metaW = 215;
  const metaX = A4[0] - M - metaW;
  let my = y;
  for (const [k, v] of meta) {
    page.drawRectangle({ x: metaX, y: my - 17, width: metaW, height: 17, borderColor: LINE, borderWidth: 0.8 });
    page.drawLine({ start: { x: metaX + metaKeyW, y: my }, end: { x: metaX + metaKeyW, y: my - 17 }, thickness: 0.8, color: LINE });
    text(k, metaX + 4, my - 12, 9, reg);
    center(wrap(bold, v, 9.5, metaW - metaKeyW - 8)[0], metaX + metaKeyW + (metaW - metaKeyW) / 2, my - 12, 9.5, bold);
    my -= 17;
  }
  let by = y - 4;
  text('RECEIVED WITH THANKS FROM', M, by, 7.5, bold, SOFT);
  by -= 15;
  for (const l of wrap(bold, r.clientName, 13, 270).slice(0, 2)) { text(l, M, by, 13, bold); by -= 15; }

  y = Math.min(by, my) - 24;
  center('RECEIPT', A4[0] / 2, y, 22, serif);
  y -= 22;

  // ----- on account of
  const purposeLines = wrap(reg, r.purpose || '—', 10, W - 16);
  const boxH = 24 + purposeLines.length * 13;
  page.drawRectangle({ x: M, y: y - boxH, width: W, height: boxH, borderColor: LINE, borderWidth: 0.9 });
  text('ON ACCOUNT OF', M + 8, y - 13, 7.5, bold, SOFT);
  purposeLines.forEach((l, i) => text(l, M + 8, y - 27 - i * 13, 10, reg));
  y -= boxH + 14;

  // ----- what was sold
  const items = receiptItemsText(r);
  const ROW = 19;
  const snW = 34;
  ensure(ROW * (items.length + 2));
  const tTop = y;
  page.drawRectangle({ x: M, y: y - ROW, width: W, height: ROW, color: TINT });
  center('SN', M + snW / 2, y - 13, 8.5, bold);
  text('SERVICES / ITEMS SOLD', M + snW + 8, y - 13, 8.5, bold);
  y -= ROW;
  (items.length ? items : ['—']).forEach((it, i) => {
    ensure(ROW);
    center(items.length ? String(i + 1) : '', M + snW / 2, y - 13, 9.5, reg);
    text(wrap(reg, it, 9.5, W - snW - 16)[0], M + snW + 8, y - 13, 9.5, reg);
    y -= ROW;
  });
  page.drawRectangle({ x: M, y, width: W, height: tTop - y, borderColor: LINE, borderWidth: 0.9 });
  page.drawLine({ start: { x: M + snW, y: tTop }, end: { x: M + snW, y }, thickness: 0.7, color: LINE });
  for (let yy = tTop - ROW; yy > y + 1; yy -= ROW) page.drawLine({ start: { x: M, y: yy }, end: { x: M + W, y: yy }, thickness: 0.4, color: rgb(0.75, 0.75, 0.78) });
  y -= 16;

  // ----- payment details
  const rows: [string, string, boolean][] = [
    ['Payment', r.paymentType === 'partial' ? 'Partial payment' : 'Full payment', false],
    ['Amount received', `${cur} ${fmtAmount(r.amountReceived)}`, true],
  ];
  if (r.paymentType === 'partial' && r.totalAmount > r.amountReceived) rows.push(['Balance remaining', `${cur} ${fmtAmount(Math.max(0, r.totalAmount - r.amountReceived))}`, false]);
  rows.push(['Received through', r.method === 'bank' ? 'Bank transfer' : 'Cash', false]);
  if (r.method === 'bank' && r.bankName) rows.push(['Bank', r.bankName, false]);
  if (r.referenceNo) rows.push(['Reference No / Transaction ID', r.referenceNo, false]);
  const keyW = 190;
  ensure(rows.length * 22 + 80);
  const pTop = y;
  for (const [k, v, strong] of rows) {
    const vLines = wrap(strong ? bold : reg, v, strong ? 12 : 10, W - keyW - 16);
    const h = Math.max(22, vLines.length * 13 + 9);
    if (strong) page.drawRectangle({ x: M, y: y - h, width: W, height: h, color: TINT });
    text(k, M + 8, y - 14.5, 9.5, strong ? bold : reg, strong ? INK : SOFT);
    vLines.forEach((l, i) => text(l, M + keyW + 8, y - 14.5 - i * 13, strong ? 12 : 10, strong ? bold : reg));
    y -= h;
    page.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness: 0.4, color: rgb(0.75, 0.75, 0.78) });
  }
  page.drawRectangle({ x: M, y, width: W, height: pTop - y, borderColor: LINE, borderWidth: 0.9 });
  page.drawLine({ start: { x: M + keyW, y: pTop }, end: { x: M + keyW, y }, thickness: 0.7, color: LINE });

  // ----- closing
  y -= 40;
  ensure(60);
  text(company.footer || 'Thanking you', M, y, 10, reg);
  page.drawLine({ start: { x: M + 0, y: y - 34 }, end: { x: M + 150, y: y - 34 }, thickness: 0.6, color: LINE });
  text(receivedBy ? `Received by ${receivedBy}` : 'Received by', M, y - 44, 8, reg, SOFT);
  page.drawLine({ start: { x: A4[0] - M - 150, y: y - 34 }, end: { x: A4[0] - M, y: y - 34 }, thickness: 0.6, color: LINE });
  center('Authorised signature', A4[0] - M - 75, y - 44, 8, reg, SOFT);

  const contact = safe(reg, [company.address, company.phone, company.email, company.website].filter(Boolean).join('  |  '));
  pdf.getPages().forEach((p, i, all) => {
    const t = `${r.receiptNo}  ·  Page ${i + 1} of ${all.length}`;
    p.drawText(t, { x: A4[0] / 2 - reg.widthOfTextAtSize(t, 7) / 2, y: 20, size: 7, font: reg, color: SOFT });
    if (contact) p.drawText(contact, { x: A4[0] / 2 - reg.widthOfTextAtSize(contact, 7) / 2, y: 31, size: 7, font: reg, color: SOFT });
    p.drawText(SYSTEM_LINE_RECEIPT, { x: A4[0] / 2 - bold.widthOfTextAtSize(SYSTEM_LINE_RECEIPT, 7.5) / 2, y: 43, size: 7.5, font: bold, color: SOFT });
  });
  return pdf.save();
}

export const receiptFileName = (r: CrmReceipt) => `${r.receiptNo}-${r.clientName.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'receipt'}.pdf`;

export async function receiptPdfFile(r: CrmReceipt, company: CompanyProfile, receivedBy: string): Promise<File> {
  return new File([new Uint8Array(await buildReceiptPdf(r, company, receivedBy))], receiptFileName(r), { type: 'application/pdf' });
}

export async function downloadReceiptPdf(r: CrmReceipt, company: CompanyProfile, receivedBy: string): Promise<void> {
  const file = await receiptPdfFile(r, company, receivedBy);
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}
