import { AttendanceRecord } from '../types';

export type PunchNoteEntry = NonNullable<AttendanceRecord['notesLog']>[number];

const KIND_LABEL: Record<string, string> = { punch_in: 'Punch in', punch_out: 'Punch out', note: 'Note', admin_note: 'Admin note' };

/** All remarks ever typed on this day's attendance (punch in, punch out, extra notes), oldest first. */
export function getPunchNotes(rec: Pick<AttendanceRecord, 'notes' | 'notesLog'>): PunchNoteEntry[] {
  const log = Array.isArray(rec.notesLog) ? rec.notesLog.filter((e) => e && e.text) : [];
  const latest = String(rec.notes || '').trim();
  // records saved before the log existed only have the single latest note
  if (log.length === 0 && latest) return [{ id: 'legacy', at: '', kind: 'note', by: '', text: latest }];
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
export const punchNotesText = (rec: Pick<AttendanceRecord, 'notes' | 'notesLog'>): string =>
  getPunchNotes(rec).map((e) => `[${punchNoteLabel(e)}] ${e.text}`).join(' | ');
