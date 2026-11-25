import crypto from 'crypto';
import { evaluateAttendancePresenceAndAutoClose, format12h, getShiftEndWindowMs, setNoCacheHeaders } from './_cloud.js';
import { isSupabaseConfigured, supabaseFetch, sweepAutoClose, sweepShiftReminders } from './_supabase.js';

/**
 * Background jobs that must run even when nobody has the app open.
 *
 *   ?task=sweep   Every 2 minutes from the database scheduler (pg_cron): sends punch-out reminders and
 *                 auto punches people out at Shift End + 2h when they did not confirm they are still working.
 *                 Needs header  Authorization: Bearer <CRON_SECRET>
 *
 *   ?task=backup  Nightly at 12:00 AM from the Google Apps Script in the owner's Google Drive:
 *                 returns a full copy of every database table.
 *                 Needs header  x-backup-key: <BACKUP_KEY>
 */
function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
}

export default async function handler(req, res) {
  setNoCacheHeaders(res);
  const task = String(req.query?.task || '');
  try {
    if (!isSupabaseConfigured()) return res.status(503).json({ ok: false, error: 'Database not configured.' });

    if (task === 'sweep') {
      const secret = process.env.CRON_SECRET;
      const given = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (!secret || !safeEqual(given, secret)) return res.status(401).json({ ok: false, error: 'Unauthorized' });
      const reminders = await sweepShiftReminders({ getShiftEndWindowMs, format12h });
      const closed = await sweepAutoClose(evaluateAttendancePresenceAndAutoClose);
      return res.status(200).json({ ok: true, reminders, closed, at: new Date().toISOString() });
    }

    if (task === 'backup') {
      const key = process.env.BACKUP_KEY;
      if (!key || !safeEqual(req.headers['x-backup-key'], key)) return res.status(401).json({ ok: false, error: 'Unauthorized' });
      const tables = await supabaseFetch('/rpc/backup_export', { method: 'POST', body: '{}' });
      const counts = Object.fromEntries(Object.entries(tables || {}).map(([name, rows]) => [name, Array.isArray(rows) ? rows.length : 0]));
      return res.status(200).json({
        ok: true,
        app: 'Bahaar Journeys Office Attendance Tracker',
        createdAt: new Date().toISOString(),
        createdAtPakistan: new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', dateStyle: 'full', timeStyle: 'medium' }).format(new Date()),
        tableCounts: counts,
        tables,
      });
    }

    return res.status(404).json({ ok: false, error: 'Unknown task.' });
  } catch (err) {
    console.error('system task failed:', task, err);
    return res.status(500).json({ ok: false, error: 'Task failed.' });
  }
}
