import { PDFDocument, PDFFont, PDFPage, StandardFonts, degrees, rgb } from 'pdf-lib';
import { CompanyProfile, CrmInvoice } from './crmApi';
import { fmtAmount } from './currencies';
import { crmQueryOf, ntnShown } from './invoiceHelpers';

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
  pdf.setTitle(`${inv.kind === 'vendor' ? 'Payable' : 'Invoice'} ${inv.invoiceNo}`);
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

  const vendor = inv.kind === 'vendor';

  // ----- header: big logo on top, bill-to on the left and the meta table on the right (like the sample invoice)
  const logoW = 440;
  if (logo) {
    const h = (logo.height / logo.width) * logoW;
    page.drawImage(logo, { x: M - 6, y: y - h, width: logoW, height: h });
    y -= h + 10;
  } else {
    text(company.name || 'Company', M, y - 22, 24, bold, BLUE);
    y -= 40;
  }

  const meta: [string, string][] = [[vendor ? 'Bill No' : 'Invoice No', inv.invoiceNo], [vendor ? 'Bill Date' : 'Invoice Date', niceDate(inv.invoiceDate)]];
  if (inv.dueDate) meta.push(['Due Date', niceDate(inv.dueDate)]);
  // rows that are empty (or switched off, like the NTN) are simply left out, so the table always fits what is there
  const ntn = ntnShown(inv, company);
  if (ntn) meta.push(['NTN#', ntn]);
  if (inv.reference) meta.push(['Reference', inv.reference]);
  if (crmQueryOf(inv)) meta.push(['CRM ID / Query Code', crmQueryOf(inv)]);
  const metaKeyW = Math.max(82, ...meta.map(([k]) => reg.widthOfTextAtSize(k, 9) + 10));
  const metaW = Math.max(215, metaKeyW + 118);
  const metaX = A4[0] - M - metaW;
  let my = y;
  for (const [k, v] of meta) {
    page.drawRectangle({ x: metaX, y: my - 17, width: metaW, height: 17, borderColor: LINE, borderWidth: 0.8 });
    page.drawLine({ start: { x: metaX + metaKeyW, y: my }, end: { x: metaX + metaKeyW, y: my - 17 }, thickness: 0.8, color: LINE });
    text(k, metaX + 4, my - 12, 9, reg);
    center(wrap(bold, v, 9.5, metaW - metaKeyW - 8)[0], metaX + metaKeyW + (metaW - metaKeyW) / 2, my - 12, 9.5, bold);
    my -= 17;
  }

  // customer (or vendor) on the left, level with the meta table
  let by = y - 4;
  text(vendor ? 'VENDOR' : 'BILL TO', M, by, 7.5, bold, SOFT);
  by -= 14;
  text(wrap(bold, inv.customerName, 12, 280)[0], M, by, 12, bold);
  by -= 13;
  for (const l of [inv.customerPhone && `Phone: ${inv.customerPhone}`, inv.customerAddress].filter(Boolean) as string[]) {
    for (const w of wrap(reg, l, 9, 280)) { text(w, M, by, 9, reg); by -= 11.5; }
  }

  y = Math.min(by, my) - 22;
  center(vendor ? 'VENDOR PAYABLE' : 'INVOICE', A4[0] / 2, y, 21, serif);
  y -= 14;

  // ----- items table
  const ROW = 19;
  let tableTop = y;
  let tableOpen = true;
  const drawHeader = () => {
    page.drawRectangle({ x: M, y: y - 18, width: W, height: 18, borderColor: LINE, borderWidth: 0.9 });
    center('SN', colX(0) + COLS[0] / 2, y - 12.5, 8.5, bold);
    center('DESCRIPTION', colX(1) + COLS[1] / 2, y - 12.5, 8.5, bold);
    center(vendor ? 'COST' : 'UNIT PRICE', colX(2) + COLS[2] / 2, y - 12.5, 8.5, bold);
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
      center(String(sn), colX(0) + COLS[0] / 2, y - 13, 9, reg);
      text(wrap(bold, sec.title, 9, COLS[1] + COLS[2] + COLS[3] + COLS[4] - 10)[0], colX(1) + 4, y - 13, 9, bold);
      y -= ROW;
    }
    for (const l of sec.lines) {
      const descLines = wrap(l.note ? bold : reg, l.description, 9, COLS[1] - 10);
      const foreign = !l.note && (l.currency || cur) !== cur && Boolean(l.rate);
      const h = Math.max(foreign ? ROW + 8 : ROW, descLines.length * 12 + 7);
      ensure(h);
      descLines.forEach((dl, i) => text(dl, colX(1) + 4, y - 13 - i * 12, 9, l.note ? bold : reg));
      if (!l.note) {
        center(`${l.currency || cur} ${fmtAmount(l.unitPrice || 0)}`, colX(2) + COLS[2] / 2, y - 13, 9, reg);
        center(fmtAmount(l.units ?? 1), colX(3) + COLS[3] / 2, y - 13, 9, reg);
        right(fmtAmount(l.amount || 0), colX(4) + COLS[4] - 6, y - 13, 9, reg);
        if (foreign) center(`1 ${l.currency} = ${fmtAmount(l.rate || 0)} ${cur}`, colX(2) + COLS[2] / 2, y - 22, 6.5, reg, SOFT);
      }
      y -= h;
    }
    y -= 4;
  }

  // ----- totals inside the same table
  const amountRight = colX(4) + COLS[4] - 6;
  if (inv.taxAmount > 0) {
    ensure(ROW + 2);
    text((inv.taxLabel || 'TAX').toUpperCase(), colX(1) + 4, y - 13, 9, bold);
    right(fmtAmount(inv.taxAmount), amountRight, y - 13, 9, reg);
    y -= ROW;
  }
  if (inv.discount > 0) {
    ensure(ROW + 2);
    text('DISCOUNT', colX(1) + 4, y - 13, 9, bold);
    right(`-${fmtAmount(inv.discount)}`, amountRight, y - 13, 9, reg);
    y -= ROW;
  }
  y -= 6;
  closeTable();

  // Total row, payment box and Balance row stay inside the same grid, as in the sample invoice
  const gridRow = (h: number) => {
    page.drawRectangle({ x: M, y: y - h, width: W, height: h, borderColor: LINE, borderWidth: 0.9 });
    for (let i = 1; i < COLS.length; i++) {
      if (i === 2 || i === 3) continue; // the middle columns merge in these rows
      page.drawLine({ start: { x: colX(i), y }, end: { x: colX(i), y: y - h }, thickness: 0.7, color: LINE });
    }
  };
  const totalRow = (label: string, value: string, strong: boolean) => {
    ensure(24);
    gridRow(20);
    center(label, colX(3) + COLS[3] / 2, y - 14, 10, bold);
    if (strong) right(value, amountRight, y - 14, 10, bold);
    else center(value, colX(4) + COLS[4] / 2, y - 14, 10, bold);
    y -= 20;
  };
  totalRow('Total', fmtAmount(inv.total), true);
  // Every payment received is listed on its own line with its date, like the sample invoice ("1st payment 30-09-26  -100,000")
  const pays = !vendor ? (inv.payments || []) : [];
  if (pays.length) {
    const ordinal = (n: number) => `${n}${[11, 12, 13].includes(n % 100) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] || 'th'}`;
    pays.forEach((p, i) => {
      ensure(24);
      gridRow(16);
      const short = (d: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || ''); return m ? `${m[3]}-${m[2]}-${m[1].slice(2)}` : niceDate(d); }; // 30-09-26, like the sample
      const label = p.id === 'pay-legacy' ? `Advance ${short(p.date)}` : `${ordinal(i + 1)} payment ${short(p.date)}${p.receiptNo ? `  (Receipt ${p.receiptNo})` : ''}`;
      text(wrap(reg, label, 8.5, COLS[1] + COLS[2] - 10)[0], colX(1) + 4, y - 11.5, 8.5, reg);
      right(`-${fmtAmount(p.amount)}`, amountRight, y - 11.5, 9, reg);
      y -= 16;
    });
  } else if (inv.advancePaid > 0) totalRow(vendor ? 'Paid' : 'Advance', `-${fmtAmount(inv.advancePaid)}`, true);

  // payment instruction box
  const payTo = company.payTo || company.name;
  const instr: string[] = [];
  if (vendor) {
    instr.push(`TOTAL PAYABLE TO ${inv.customerName.toUpperCase()}: ${cur} ${fmtAmount(inv.balance)}/-`);
  } else if (payTo && inv.status !== 'paid') {
    instr.push(`KINDLY MAKE CHEQUE OF ${cur} ${fmtAmount(inv.balance)}/- IN FAVOR OF ${payTo.toUpperCase()}`);
  }
  if (!vendor && company.bankDetails) instr.push(...company.bankDetails.split('\n'));
  const instrLines = instr.flatMap((t) => wrap(reg, t, 9.5, COLS[1] - 12));
  if (instrLines.length) {
    const boxH = Math.max(56, instrLines.length * 12 + 34);
    ensure(boxH + 24);
    gridRow(boxH);
    let ty = y - boxH + 14 + (instrLines.length - 1) * 12;
    instrLines.forEach((l, i) => {
      if (i === 0 && !vendor && l.startsWith('KINDLY')) {
        // amount in bold like the sample
        const amt = `${cur} ${fmtAmount(inv.balance)}/-`;
        const at = l.indexOf(amt);
        if (at >= 0) {
          const pre = l.slice(0, at);
          text(pre, colX(1) + 6, ty, 9.5, reg);
          const x2 = colX(1) + 6 + reg.widthOfTextAtSize(safe(reg, pre), 9.5) + 1.5;
          text(amt, x2, ty, 9.5, bold);
          text(l.slice(at + amt.length), x2 + bold.widthOfTextAtSize(safe(bold, amt), 9.5), ty, 9.5, reg);
          ty -= 12;
          return;
        }
      }
      text(l, colX(1) + 6, ty, 9.5, reg);
      ty -= 12;
    });
    y -= boxH;
  }
  totalRow('Balance', `${fmtAmount(inv.balance)}`, false);

  const notes = [inv.notes, vendor ? '' : company.terms].filter(Boolean).join('\n');
  y -= 14;
  if (notes) {
    ensure(40);
    text('NOTES', M, y, 8, bold, SOFT); y -= 11;
    for (const l of wrap(reg, notes, 8.5, W)) { ensure(14); text(l, M, y, 8.5, reg, SOFT); y -= 11; }
    y -= 6;
  }

  // ----- closing line
  ensure(60);
  y -= 6;
  text(vendor ? 'Internal payable record — not for customers' : company.footer || 'Thanking you', M, y, vendor ? 8.5 : 10, vendor ? reg : reg, vendor ? SOFT : INK);
  hline(A4[0] - M - 150, A4[0] - M, y - 22, 0.6);
  center('Authorised signature', A4[0] - M - 75, y - 32, 8, reg, SOFT);
  if (preparedBy) text(`Prepared by ${preparedBy}`, M, y - 18, 7.5, reg, SOFT);

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
    const contact = vendor ? '' : safe(reg, [company.address, company.phone, company.email, company.website].filter(Boolean).join('  |  '));
    if (contact) p.drawText(contact, { x: A4[0] / 2 - reg.widthOfTextAtSize(contact, 7) / 2, y: 31, size: 7, font: reg, color: SOFT });
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

/** Internal vendor-payables statement of one customer invoice (office record, never given to the customer). */
export async function buildVendorPayablesPdf(inv: CrmInvoice, company: CompanyProfile, preparedBy: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Vendor payables ${inv.invoiceNo}`);
  pdf.setAuthor(company.name || 'Vendor payables');
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const serif = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const logo = await loadLogo(pdf);
  const paid = inv.vendorStatus === 'paid';
  const rows = (inv.vendors || []).filter((v) => v.name || (v.amount ?? 0) > 0);
  const COL = [28, 120, 150, 100, 117]; // SN, vendor, description, bank, payable (sum 515)
  const colX = (i: number) => M + COL.slice(0, i).reduce((a, b) => a + b, 0);

  let page: PDFPage = pdf.addPage(A4);
  let y = A4[1] - M;
  const text = (t: string, x: number, yy: number, size = 9, font: PDFFont = reg, color = INK) => page.drawText(safe(font, t), { x, y: yy, size, font, color });
  const right = (t: string, xr: number, yy: number, size = 9, font: PDFFont = reg, color = INK) =>
    page.drawText(safe(font, t), { x: xr - font.widthOfTextAtSize(safe(font, t), size), y: yy, size, font, color });
  const hline = (yy: number) => page.drawLine({ start: { x: M, y: yy }, end: { x: A4[0] - M, y: yy }, thickness: 0.7, color: LINE });

  if (logo) {
    const logoW = 300;
    const h = (logo.height / logo.width) * logoW;
    page.drawImage(logo, { x: M - 4, y: y - h, width: logoW, height: h });
    y -= h + 10;
  } else {
    text(company.name || 'Company', M, y - 20, 20, bold, BLUE);
    y -= 34;
  }

  const title = 'VENDOR PAYABLES';
  page.drawText(title, { x: A4[0] / 2 - serif.widthOfTextAtSize(title, 20) / 2, y: y - 14, size: 20, font: serif, color: INK });
  y -= 36;
  const stamp = paid ? 'PAID' : 'UNPAID';
  const stampCol = paid ? rgb(0.05, 0.5, 0.25) : rgb(0.75, 0.45, 0.05);
  right(stamp, A4[0] - M, y + 6, 14, bold, stampCol);

  const meta: [string, string][] = [
    ['Invoice No', inv.invoiceNo], ['Customer', inv.customerName], ['CRM ID / Query Code', crmQueryOf(inv) || '-'],
    ['Invoice Date', niceDate(inv.invoiceDate)], ['Vendor side status', paid ? `Paid${inv.vendorPaidAt ? ' on ' + niceDate(inv.vendorPaidAt) : ''}` : 'Unpaid'],
  ];
  meta.forEach(([k, v]) => { text(k, M, y, 9, bold, SOFT); text(v, M + 130, y, 9.5, reg); y -= 14; });
  y -= 8;

  const head = () => {
    page.drawRectangle({ x: M, y: y - 16, width: 515, height: 18, color: GREY });
    ['SN', 'VENDOR', 'DESCRIPTION', 'BANK', 'PAYABLE'].forEach((h, i) => {
      if (i === 4) right(h, colX(4) + COL[4] - 4, y - 11, 8.5, bold);
      else text(h, colX(i) + 4, y - 11, 8.5, bold);
    });
    y -= 20;
  };
  head();
  const totals = new Map<string, number>();
  rows.forEach((v, idx) => {
    const cur = v.currency || inv.currency;
    totals.set(cur, (totals.get(cur) || 0) + (v.amount || 0));
    const desc = wrap(reg, [v.description || '', v.unitPrice !== null && v.unitPrice !== undefined ? `${cur} ${fmtAmount(v.unitPrice)} x ${fmtAmount(v.units ?? 1)}` : ''].filter(Boolean).join('\n'), 8.5, COL[2] - 8);
    const bank = wrap(reg, v.bank || '', 8, COL[3] - 8);
    const name = wrap(bold, v.name || '-', 9, COL[1] - 8);
    const lines = Math.max(desc.length, bank.length, name.length);
    const h = lines * 11 + 8;
    if (y - h < 60) { page = pdf.addPage(A4); y = A4[1] - M; head(); }
    text(String(idx + 1), colX(0) + 4, y - 11, 9);
    name.forEach((l, i) => text(l, colX(1) + 4, y - 11 - i * 11, 9, bold));
    desc.forEach((l, i) => text(l, colX(2) + 4, y - 11 - i * 11, 8.5));
    bank.forEach((l, i) => text(l, colX(3) + 4, y - 11 - i * 11, 8, reg, SOFT));
    right(`${cur} ${fmtAmount(v.amount || 0)}`, colX(4) + COL[4] - 4, y - 11, 9, bold);
    y -= h;
    page.drawLine({ start: { x: M, y }, end: { x: A4[0] - M, y }, thickness: 0.4, color: GREY });
  });
  if (!rows.length) { text('No vendor payables recorded for this invoice.', M + 4, y - 14, 9, reg, SOFT); y -= 24; }
  y -= 8;
  hline(y);
  y -= 16;
  [...totals.entries()].forEach(([cur, amt]) => {
    text('Total payable', colX(3) + 4, y, 9.5, bold);
    right(`${cur} ${fmtAmount(amt)}`, colX(4) + COL[4] - 4, y, 10.5, bold);
    y -= 15;
  });
  y -= 14;
  text('Internal payable record - not for customers', M, y, 8.5, reg, SOFT);
  if (preparedBy) text(`Prepared by ${preparedBy}`, M, y - 11, 8, reg, SOFT);

  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    const t = `${inv.invoiceNo} vendor payables  -  Page ${i + 1} of ${pages.length}`;
    p.drawText(t, { x: A4[0] / 2 - reg.widthOfTextAtSize(t, 7) / 2, y: 20, size: 7, font: reg, color: SOFT });
  });
  return pdf.save();
}

export async function downloadVendorPayablesPdf(inv: CrmInvoice, company: CompanyProfile, preparedBy: string): Promise<void> {
  const bytes = await buildVendorPayablesPdf(inv, company, preparedBy);
  const file = new File([bytes], `${inv.invoiceNo}-vendor-payables.pdf`, { type: 'application/pdf' });
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}
