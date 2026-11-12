import { AttendanceRecord, Employee, OfficeSettings, ShiftSchedule } from '../types';
import {
  calculateBreaksDuration,
  formatMinutesToDecimal,
  formatMinutesToHoursMinutes,
  formatTime12h,
  getLiveWorkedStats,
  deriveLiveAttendanceState,
} from './attendanceCalculations';

interface PdfTextRun {
  text: string;
  x: number;
  y: number;
  size?: number;
  bold?: boolean;
  color?: [number, number, number];
  align?: 'left' | 'right' | 'center';
}

function sanitizePdfText(input: string | number | undefined | null): string {
  if (input === undefined || input === null) return '';
  return String(input)
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2022|\u00B7/g, '|')
    .replace(/\u2713|\u2714/g, 'OK')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncateText(str: string, maxChars: number): string {
  const clean = str.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, Math.max(1, maxChars - 3))}...`;
}

function rgbFill(r: number, g: number, b: number): string {
  return `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg`;
}

function rgbStroke(r: number, g: number, b: number): string {
  return `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} RG`;
}

class PdfPageBuilder {
  public ops: string[] = [];

  rectFill(
    x: number,
    y: number,
    w: number,
    h: number,
    fill: [number, number, number],
    stroke?: [number, number, number],
    lineWidth = 0.6
  ): void {
    this.ops.push('q');
    this.ops.push(rgbFill(fill[0], fill[1], fill[2]));
    if (stroke) {
      this.ops.push(`${lineWidth.toFixed(2)} w`);
      this.ops.push(rgbStroke(stroke[0], stroke[1], stroke[2]));
      this.ops.push(`${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re B`);
    } else {
      this.ops.push(`${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
    }
    this.ops.push('Q');
  }

  line(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: [number, number, number],
    width = 0.6
  ): void {
    this.ops.push('q');
    this.ops.push(`${width.toFixed(2)} w`);
    this.ops.push(rgbStroke(color[0], color[1], color[2]));
    this.ops.push(`${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
    this.ops.push('Q');
  }

  text(run: PdfTextRun): void {
    const size = run.size ?? 9;
    const font = run.bold ? '/F2' : '/F1';
    const color = run.color ?? [0.06, 0.09, 0.16];
    const clean = sanitizePdfText(run.text);
    const estCharWidth = size * (run.bold ? 0.54 : 0.50);
    const approxWidth = clean.length * estCharWidth;
    let drawX = run.x;
    if (run.align === 'right') drawX = run.x - approxWidth;
    else if (run.align === 'center') drawX = run.x - approxWidth / 2;

    this.ops.push('BT');
    this.ops.push(`${font} ${size.toFixed(1)} Tf`);
    this.ops.push(rgbFill(color[0], color[1], color[2]));
    this.ops.push(`1 0 0 1 ${drawX.toFixed(2)} ${run.y.toFixed(2)} Tm`);
    this.ops.push(`(${clean}) Tj`);
    this.ops.push('ET');
  }

  buildStream(): string {
    return this.ops.join('\n');
  }
}

function assemblePdfBinary(pageStreams: string[]): Uint8Array {
  const PAGE_W = 595.28;
  const PAGE_H = 841.89;
  const encoder = new TextEncoder();

  // Object IDs:
  // 1: Catalog, 2: Pages, 3: Helvetica (/F1), 4: Helvetica-Bold (/F2)
  // Then per page i: (5 + 2*i) = Page object, (6 + 2*i) = Content stream
  const pageCount = Math.max(1, pageStreams.length);
  const pageIds: number[] = [];
  for (let i = 0; i < pageCount; i++) {
    pageIds.push(5 + i * 2);
  }

  const objects: string[] = [];
  objects[1] = '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';
  objects[2] = `2 0 obj\n<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageCount} >>\nendobj\n`;
  objects[3] = '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n';
  objects[4] = '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n';

  for (let i = 0; i < pageCount; i++) {
    const pageObjId = 5 + i * 2;
    const contentObjId = 6 + i * 2;
    const stream = pageStreams[i] || '';
    const streamByteLength = encoder.encode(stream).length;
    objects[pageObjId] =
      `${pageObjId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjId} 0 R >>\nendobj\n`;
    objects[contentObjId] =
      `${contentObjId} 0 obj\n<< /Length ${streamByteLength} >>\nstream\n${stream}\nendstream\nendobj\n`;
  }

  const chunks: Uint8Array[] = [];
  const offsets: number[] = [0];
  const headerBytes = encoder.encode('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  chunks.push(headerBytes);
  let byteCursor = headerBytes.length;

  for (let id = 1; id < objects.length; id++) {
    offsets[id] = byteCursor;
    const objBytes = encoder.encode(objects[id]);
    chunks.push(objBytes);
    byteCursor += objBytes.length;
  }

  const xrefOffset = byteCursor;
  const totalObjs = objects.length;
  const xrefLines = [`xref\n0 ${totalObjs}\n0000000000 65535 f \n`];
  for (let id = 1; id < totalObjs; id++) {
    xrefLines.push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  }
  const trailer =
    `${xrefLines.join('')}trailer\n<< /Size ${totalObjs} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  const trailerBytes = encoder.encode(trailer);
  chunks.push(trailerBytes);
  byteCursor += trailerBytes.length;

  const out = new Uint8Array(byteCursor);
  let writePos = 0;
  for (const chunk of chunks) {
    out.set(chunk, writePos);
    writePos += chunk.length;
  }
  return out;
}

export interface OfficialTimesheetPdfOptions {
  employee: Employee | null;
  allEmployees: Employee[];
  records: AttendanceRecord[];
  shifts?: ShiftSchedule[];
  settings: OfficeSettings;
  periodLabel?: string;
  generatedBy?: Employee | null;
}

/**
 * Generates an official A4 corporate PDF timesheet as binary PDF bytes (%PDF-1.4).
 */
export function buildOfficialTimesheetPdfBytes({
  employee,
  allEmployees,
  records,
  shifts = [],
  settings,
  periodLabel,
  generatedBy,
}: OfficialTimesheetPdfOptions): Uint8Array {
  const empMap = new Map(allEmployees.map((e) => [e.id, e]));
  const shiftMap = new Map(shifts.map((s) => [s.id, s]));
  const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date));

  let totalWorkedMins = 0;
  let totalRegularMins = 0;
  let totalOvertimeMins = 0;
  let totalBreakMins = 0;
  let lateDays = 0;

  const computedRows = sorted.map((rec) => {
    const emp = empMap.get(rec.employeeId) || employee || undefined;
    const shift = (emp ? shiftMap.get(emp.shiftId) : undefined) || shifts[0];
    const breakMins = calculateBreaksDuration(rec.breaks);
    const liveState = deriveLiveAttendanceState({ record: rec, settings });
    const stats =
      !rec.timeOut && rec.timeIn && shift
        ? getLiveWorkedStats({ record: rec, shift, settings, liveState })
        : {
            totalWorkedMinutes: rec.totalWorkedMinutes || 0,
            regularMinutes: rec.regularMinutes || 0,
            overtimeMinutes: rec.overtimeMinutes || 0,
          };

    totalWorkedMins += stats.totalWorkedMinutes;
    totalRegularMins += stats.regularMinutes;
    totalOvertimeMins += stats.overtimeMinutes;
    totalBreakMins += breakMins;
    if (rec.status === 'late') lateDays++;

    const verTags: string[] = [];
    if (rec.adminVerification?.verified) verTags.push('Adm');
    if (rec.accountsVerification?.verified) verTags.push('Acc');

    return {
      rec,
      emp,
      breakMins,
      stats,
      verLabel: verTags.length > 0 ? verTags.join('+') : '-',
    };
  });

  const startDate = sorted[0]?.date || 'N/A';
  const endDate = sorted[sorted.length - 1]?.date || 'N/A';
  const effectivePeriod = periodLabel || `${startDate} to ${endDate}`;
  const empShift = employee ? shiftMap.get(employee.shiftId) || shifts[0] : undefined;

  const PAGE_W = 595.28;
  const MARGIN_L = 34;
  const MARGIN_R = PAGE_W - 34;
  const CONTENT_W = MARGIN_R - MARGIN_L; // 527.28

  const COL_SINGLE = [
    { label: 'Date', x: MARGIN_L + 4, align: 'left' as const },
    { label: 'Day', x: MARGIN_L + 66, align: 'left' as const },
    { label: 'Time In', x: MARGIN_L + 100, align: 'left' as const },
    { label: 'Time Out', x: MARGIN_L + 162, align: 'left' as const },
    { label: 'Break', x: MARGIN_L + 244, align: 'right' as const },
    { label: 'Regular', x: MARGIN_L + 294, align: 'right' as const },
    { label: 'OT', x: MARGIN_L + 338, align: 'right' as const },
    { label: 'Total', x: MARGIN_L + 394, align: 'right' as const },
    { label: 'Status', x: MARGIN_L + 436, align: 'center' as const },
    { label: 'Verify', x: MARGIN_L + 500, align: 'center' as const },
  ];

  const COL_TEAM = [
    { label: 'Date', x: MARGIN_L + 4, align: 'left' as const },
    { label: 'Employee', x: MARGIN_L + 66, align: 'left' as const },
    { label: 'Time In', x: MARGIN_L + 178, align: 'left' as const },
    { label: 'Time Out', x: MARGIN_L + 242, align: 'left' as const },
    { label: 'Break', x: MARGIN_L + 324, align: 'right' as const },
    { label: 'Regular', x: MARGIN_L + 372, align: 'right' as const },
    { label: 'OT', x: MARGIN_L + 414, align: 'right' as const },
    { label: 'Total', x: MARGIN_L + 468, align: 'right' as const },
    { label: 'Status', x: MARGIN_L + 504, align: 'center' as const },
  ];

  const drawHeaderAndMeta = (page: PdfPageBuilder): number => {
    // Dark slate letterhead bar
    page.rectFill(MARGIN_L, 756, CONTENT_W, 54, [0.06, 0.09, 0.16]);
    page.text({
      text: settings.companyName.toUpperCase(),
      x: MARGIN_L + 14,
      y: 787,
      size: 14,
      bold: true,
      color: [1, 1, 1],
    });
    page.text({
      text: truncateText(
        `${settings.companyAddress} | Tel: ${settings.companyPhone} | ${settings.companyEmail}`,
        88
      ),
      x: MARGIN_L + 14,
      y: 769,
      size: 7.5,
      color: [0.80, 0.85, 0.92],
    });
    page.rectFill(MARGIN_R - 142, 777, 130, 20, [0.15, 0.39, 0.92]);
    page.text({
      text: 'OFFICIAL TIMESHEET',
      x: MARGIN_R - 77,
      y: 784,
      size: 8.5,
      bold: true,
      color: [1, 1, 1],
      align: 'center',
    });
    page.text({
      text: `Issued: ${new Date().toISOString().slice(0, 10)}`,
      x: MARGIN_R - 12,
      y: 765,
      size: 7.2,
      color: [0.78, 0.84, 0.92],
      align: 'right',
    });

    // Employee / Pay Period box
    page.rectFill(MARGIN_L, 682, CONTENT_W, 64, [0.97, 0.98, 0.99], [0.84, 0.87, 0.91], 0.7);
    if (employee) {
      page.text({ text: 'EMPLOYEE PROFILE', x: MARGIN_L + 10, y: 733, size: 7, bold: true, color: [0.40, 0.45, 0.53] });
      page.text({
        text: `${employee.name} (${employee.employeeCode})`,
        x: MARGIN_L + 10,
        y: 718,
        size: 11,
        bold: true,
        color: [0.06, 0.09, 0.16],
      });
      page.text({
        text: truncateText(`${employee.designation} | Dept: ${employee.department}`, 56),
        x: MARGIN_L + 10,
        y: 704,
        size: 8.2,
        color: [0.28, 0.33, 0.41],
      });
      page.text({
        text: truncateText(
          `Shift: ${empShift ? `${empShift.name} (${formatTime12h(empShift.startTime)} - ${formatTime12h(empShift.endTime)})` : 'Standard'}`,
          56
        ),
        x: MARGIN_L + 10,
        y: 691,
        size: 8,
        color: [0.35, 0.41, 0.49],
      });
    } else {
      page.text({ text: 'TIMESHEET SCOPE', x: MARGIN_L + 10, y: 733, size: 7, bold: true, color: [0.40, 0.45, 0.53] });
      page.text({
        text: 'All Active Office Personnel',
        x: MARGIN_L + 10,
        y: 718,
        size: 11,
        bold: true,
        color: [0.06, 0.09, 0.16],
      });
      page.text({
        text: `Company-Wide Attendance & Payroll Export (${allEmployees.filter((e) => e.isActive).length} active staff)`,
        x: MARGIN_L + 10,
        y: 703,
        size: 8.2,
        color: [0.28, 0.33, 0.41],
      });
    }

    page.text({
      text: 'PAY PERIOD & AUDIT',
      x: MARGIN_R - 10,
      y: 733,
      size: 7,
      bold: true,
      color: [0.40, 0.45, 0.53],
      align: 'right',
    });
    page.text({
      text: truncateText(effectivePeriod, 42),
      x: MARGIN_R - 10,
      y: 718,
      size: 9.8,
      bold: true,
      color: [0.06, 0.09, 0.16],
      align: 'right',
    });
    page.text({
      text: `Days Logged: ${computedRows.length} | Late Arrivals: ${lateDays}`,
      x: MARGIN_R - 10,
      y: 704,
      size: 8.2,
      color: [0.28, 0.33, 0.41],
      align: 'right',
    });
    page.text({
      text: generatedBy ? `Prepared By: ${generatedBy.name} (${generatedBy.role.toUpperCase()})` : 'Authorized System Export',
      x: MARGIN_R - 10,
      y: 691,
      size: 8,
      color: [0.35, 0.41, 0.49],
      align: 'right',
    });

    // 4 KPI Summary Strip
    const boxW = (CONTENT_W - 18) / 4;
    const summaryBoxes = [
      { label: 'TOTAL REGULAR', val: formatMinutesToHoursMinutes(totalRegularMins), sub: `${formatMinutesToDecimal(totalRegularMins)} hrs` },
      { label: 'TOTAL OVERTIME', val: formatMinutesToHoursMinutes(totalOvertimeMins), sub: `${formatMinutesToDecimal(totalOvertimeMins)} hrs OT` },
      { label: 'TOTAL NET WORKED', val: formatMinutesToHoursMinutes(totalWorkedMins), sub: `${formatMinutesToDecimal(totalWorkedMins)} net hrs` },
      { label: 'BREAK / LATE LOGS', val: `${totalBreakMins}m Break`, sub: `${lateDays} Late Day(s)` },
    ];
    summaryBoxes.forEach((box, idx) => {
      const bx = MARGIN_L + idx * (boxW + 6);
      page.rectFill(bx, 626, boxW, 46, [1, 1, 1], [0.80, 0.84, 0.89], 0.7);
      page.text({ text: box.label, x: bx + boxW / 2, y: 659, size: 6.8, bold: true, color: [0.40, 0.45, 0.53], align: 'center' });
      page.text({ text: box.val, x: bx + boxW / 2, y: 644, size: 10.5, bold: true, color: idx === 2 ? [0.09, 0.30, 0.72] : [0.06, 0.09, 0.16], align: 'center' });
      page.text({ text: box.sub, x: bx + boxW / 2, y: 632, size: 7.2, color: [0.45, 0.50, 0.58], align: 'center' });
    });

    return 608;
  };

  const drawTableHeader = (page: PdfPageBuilder, topY: number): number => {
    page.rectFill(MARGIN_L, topY - 18, CONTENT_W, 18, [0.92, 0.94, 0.97], [0.75, 0.80, 0.86], 0.7);
    const cols = employee ? COL_SINGLE : COL_TEAM;
    cols.forEach((col) => {
      page.text({
        text: col.label,
        x: col.x,
        y: topY - 12,
        size: 7.5,
        bold: true,
        color: [0.15, 0.20, 0.28],
        align: col.align,
      });
    });
    return topY - 18;
  };

  const pages: PdfPageBuilder[] = [];
  let currentPage = new PdfPageBuilder();
  pages.push(currentPage);

  let cursorY = drawHeaderAndMeta(currentPage);
  cursorY = drawTableHeader(currentPage, cursorY);

  const ROW_H = 16.5;
  const MIN_Y_FOR_ROW = 92;

  if (computedRows.length === 0) {
    currentPage.rectFill(MARGIN_L, cursorY - 28, CONTENT_W, 28, [0.99, 0.99, 1], [0.85, 0.88, 0.92], 0.5);
    currentPage.text({
      text: 'No attendance records found in the selected pay period.',
      x: MARGIN_L + CONTENT_W / 2,
      y: cursorY - 17,
      size: 9,
      color: [0.45, 0.50, 0.58],
      align: 'center',
    });
    cursorY -= 28;
  } else {
    computedRows.forEach((item, idx) => {
      if (cursorY - ROW_H < MIN_Y_FOR_ROW) {
        currentPage = new PdfPageBuilder();
        pages.push(currentPage);
        currentPage.text({
          text: `${settings.companyName} | Official Timesheet (${employee ? employee.name : 'All Staff'}) - Continued`,
          x: MARGIN_L,
          y: 808,
          size: 8.5,
          bold: true,
          color: [0.35, 0.41, 0.49],
        });
        cursorY = drawTableHeader(currentPage, 796);
      }

      const bg: [number, number, number] = idx % 2 === 1 ? [0.975, 0.982, 0.992] : [1, 1, 1];
      currentPage.rectFill(MARGIN_L, cursorY - ROW_H, CONTENT_W, ROW_H, bg, [0.90, 0.92, 0.95], 0.4);
      const textY = cursorY - 11.2;
      const { rec, emp, breakMins, stats, verLabel } = item;

      const timeInTxt = rec.timeIn ? formatTime12h(rec.timeIn) : '-';
      const timeOutTxt = rec.timeOut ? formatTime12h(rec.timeOut) : rec.timeIn ? 'Active' : '-';
      const statusTxt = String(rec.status || 'present').toUpperCase();
      const dayTxt = (
        rec.day ||
        (rec.date
          ? new Date(`${rec.date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short' })
          : '-')
      ).slice(0, 3);

      if (employee) {
        currentPage.text({ text: rec.date, x: COL_SINGLE[0].x, y: textY, size: 7.8 });
        currentPage.text({ text: dayTxt, x: COL_SINGLE[1].x, y: textY, size: 7.8 });
        currentPage.text({ text: timeInTxt, x: COL_SINGLE[2].x, y: textY, size: 7.8 });
        currentPage.text({ text: timeOutTxt, x: COL_SINGLE[3].x, y: textY, size: 7.8 });
        currentPage.text({ text: `${breakMins}m`, x: COL_SINGLE[4].x, y: textY, size: 7.8, align: 'right' });
        currentPage.text({ text: formatMinutesToDecimal(stats.regularMinutes), x: COL_SINGLE[5].x, y: textY, size: 7.8, align: 'right' });
        currentPage.text({
          text: stats.overtimeMinutes > 0 ? `+${formatMinutesToDecimal(stats.overtimeMinutes)}` : '0.00',
          x: COL_SINGLE[6].x,
          y: textY,
          size: 7.8,
          color: stats.overtimeMinutes > 0 ? [0.72, 0.35, 0.04] : [0.35, 0.41, 0.49],
          align: 'right',
        });
        currentPage.text({ text: formatMinutesToHoursMinutes(stats.totalWorkedMinutes), x: COL_SINGLE[7].x, y: textY, size: 7.8, bold: true, align: 'right' });
        currentPage.text({
          text: truncateText(statusTxt, 9),
          x: COL_SINGLE[8].x,
          y: textY,
          size: 7.2,
          bold: rec.status === 'late',
          color: rec.status === 'late' ? [0.55, 0.16, 0.65] : [0.06, 0.38, 0.24],
          align: 'center',
        });
        currentPage.text({ text: verLabel, x: COL_SINGLE[9].x, y: textY, size: 7.2, color: [0.35, 0.41, 0.49], align: 'center' });
      } else {
        currentPage.text({ text: rec.date, x: COL_TEAM[0].x, y: textY, size: 7.8 });
        currentPage.text({ text: truncateText(emp?.name || 'Unknown', 20), x: COL_TEAM[1].x, y: textY, size: 7.8, bold: true });
        currentPage.text({ text: timeInTxt, x: COL_TEAM[2].x, y: textY, size: 7.8 });
        currentPage.text({ text: timeOutTxt, x: COL_TEAM[3].x, y: textY, size: 7.8 });
        currentPage.text({ text: `${breakMins}m`, x: COL_TEAM[4].x, y: textY, size: 7.8, align: 'right' });
        currentPage.text({ text: formatMinutesToDecimal(stats.regularMinutes), x: COL_TEAM[5].x, y: textY, size: 7.8, align: 'right' });
        currentPage.text({
          text: stats.overtimeMinutes > 0 ? `+${formatMinutesToDecimal(stats.overtimeMinutes)}` : '0.00',
          x: COL_TEAM[6].x,
          y: textY,
          size: 7.8,
          align: 'right',
        });
        currentPage.text({ text: formatMinutesToHoursMinutes(stats.totalWorkedMinutes), x: COL_TEAM[7].x, y: textY, size: 7.8, bold: true, align: 'right' });
        currentPage.text({ text: truncateText(statusTxt, 9), x: COL_TEAM[8].x, y: textY, size: 7.2, align: 'center' });
      }
      cursorY -= ROW_H;
    });

    // Totals Bar
    if (cursorY - 22 < MIN_Y_FOR_ROW) {
      currentPage = new PdfPageBuilder();
      pages.push(currentPage);
      cursorY = 780;
    }
    currentPage.rectFill(MARGIN_L, cursorY - 20, CONTENT_W, 20, [0.93, 0.95, 0.98], [0.20, 0.26, 0.35], 0.8);
    const cols = employee ? COL_SINGLE : COL_TEAM;
    currentPage.text({
      text: 'PERIOD TOTALS:',
      x: cols[4].x - 42,
      y: cursorY - 13,
      size: 8,
      bold: true,
      align: 'right',
    });
    currentPage.text({ text: `${totalBreakMins}m`, x: cols[4].x, y: cursorY - 13, size: 8, bold: true, align: 'right' });
    currentPage.text({ text: `${formatMinutesToDecimal(totalRegularMins)}h`, x: cols[5].x, y: cursorY - 13, size: 8, bold: true, align: 'right' });
    currentPage.text({ text: `${formatMinutesToDecimal(totalOvertimeMins)}h`, x: cols[6].x, y: cursorY - 13, size: 8, bold: true, align: 'right' });
    currentPage.text({ text: formatMinutesToHoursMinutes(totalWorkedMins), x: cols[7].x, y: cursorY - 13, size: 8.5, bold: true, color: [0.09, 0.30, 0.72], align: 'right' });
    cursorY -= 20;
  }

  // Signature block on final page
  if (cursorY < 108) {
    currentPage = new PdfPageBuilder();
    pages.push(currentPage);
    cursorY = 760;
  }
  const sigY = Math.min(cursorY - 46, 130);
  currentPage.line(MARGIN_L + 16, sigY, MARGIN_L + 220, sigY, [0.45, 0.50, 0.58], 0.7);
  currentPage.text({
    text: employee ? employee.name : 'Employee Signature',
    x: MARGIN_L + 118,
    y: sigY - 12,
    size: 8.5,
    bold: true,
    align: 'center',
  });
  currentPage.text({
    text: 'Employee Verification Signature & Date',
    x: MARGIN_L + 118,
    y: sigY - 23,
    size: 7.2,
    color: [0.45, 0.50, 0.58],
    align: 'center',
  });

  currentPage.line(MARGIN_R - 220, sigY, MARGIN_R - 16, sigY, [0.45, 0.50, 0.58], 0.7);
  currentPage.text({
    text: generatedBy ? `${generatedBy.name} (${generatedBy.role.toUpperCase()})` : 'Admin / CEO / Accounts Approver',
    x: MARGIN_R - 118,
    y: sigY - 12,
    size: 8.5,
    bold: true,
    align: 'center',
  });
  currentPage.text({
    text: 'Authorized Signature & Official Stamp',
    x: MARGIN_R - 118,
    y: sigY - 23,
    size: 7.2,
    color: [0.45, 0.50, 0.58],
    align: 'center',
  });

  // Page footer on all pages
  const totalPages = pages.length;
  pages.forEach((p, pageIndex) => {
    p.line(MARGIN_L, 38, MARGIN_R, 38, [0.85, 0.88, 0.92], 0.5);
    p.text({
      text: `${settings.companyName} - Confidential Official Attendance Record`,
      x: MARGIN_L,
      y: 26,
      size: 7.2,
      color: [0.48, 0.53, 0.60],
    });
    p.text({
      text: `Page ${pageIndex + 1} of ${totalPages}`,
      x: MARGIN_R,
      y: 26,
      size: 7.2,
      bold: true,
      color: [0.40, 0.45, 0.53],
      align: 'right',
    });
  });

  return assemblePdfBinary(pages.map((p) => p.buildStream()));
}

/**
 * Generates and downloads an official A4 PDF timesheet directly to the user's device.
 */
export function downloadOfficialTimesheetPdf(options: OfficialTimesheetPdfOptions): void {
  const bytes = buildOfficialTimesheetPdfBytes(options);
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const safeName = options.employee
    ? `${options.employee.employeeCode}_${options.employee.name}`
    : 'All_Office_Staff';
  const cleanSlug = safeName.replace(/[^a-zA-Z0-9_-]+/g, '_');
  const stamp = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `Official_Timesheet_${cleanSlug}_${stamp}.pdf`;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
