import { AttendanceRecord } from '../types';

export type PunchNoteEntry = NonNullable<AttendanceRecord['notesLog']>[number];

const KIND_LABEL: Record<string, string> = { punch_in: 'Punch in', punch_out: 'Punch out', note: 'Note', admin_note: 'Admin note', system: 'Auto punch-out' };

/** All remarks ever typed on this day's attendance (punch in, punch out, extra notes), oldest first. */
export function getPunchNotes(rec: Pick<AttendanceRecord, 'notes' | 'notesLog'> & Partial<Pick<AttendanceRecord, 'isAutoPunchedOut'>>): PunchNoteEntry[] {
  const log = Array.isArray(rec.notesLog) ? rec.notesLog.filter((e) => e && e.text) : [];
  const latest = String(rec.notes || '').trim();
  // records saved before the log existed only have the single latest note
  if (log.length === 0 && latest) {
    const legacyAuto = (rec as AttendanceRecord).isAutoPunchedOut === true;
    return [{ id: 'legacy', at: '', kind: legacyAuto ? 'system' : 'note', by: '', text: latest }];
  }
  // the automatic punch-out adds its own sentence to the single notes field: keep it as a separate entry
  if ((rec as AttendanceRecord).isAutoPunchedOut === true && latest) {
    let rest = latest;
    for (const e of log) rest = rest.split(e.text).join('');
    rest = rest.replace(/^[\s·]+|[\s·]+$/g, '');
    if (rest) return [...log, { id: 'system', at: '', kind: 'system', by: '', text: rest }];
  }
  return log;
}

export const punchNoteLabel = (e: PunchNoteEntry): string => {
  const label = KIND_LABEL[e.kind] || 'Note';
  if (!e.at) return label;
  const d = new Date(e.at);
  if (Number.isNaN(d.getTime())) return label;
  return `${label} ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Karachi' })}`;
};

/** One line for a CSV cell or a tooltip. */
export const punchNotesText = (rec: Pick<AttendanceRecord, 'notes' | 'notesLog'> & Partial<Pick<AttendanceRecord, 'isAutoPunchedOut'>>): string =>
  getPunchNotes(rec).map((e) => `[${punchNoteLabel(e)}] ${e.text}`).join(' | ');
