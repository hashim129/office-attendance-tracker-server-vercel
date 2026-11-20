import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import {
  DEFAULT_DB,
  mergeAttendanceRecord,
  mergeSingleEmployee,
  mergeEmployeesAdditiveSafe,
  parseIsoMs,
} from './api/db.js';
import {
  evaluateAttendancePresenceAndAutoClose,
  doesIpMatchRule,
  verifyAutoStartToken,
} from './api/_cloud.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

app.set('trust proxy', true);
app.use(express.json({ limit: '25mb' }));

// Set No-Cache headers helper
function setNoCache(res: express.Response) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
}

// REST API: Return caller's observed Public/Network IP address
app.get('/api/my-ip', (req, res) => {
  setNoCache(res);
  const forwarded = req.headers['x-forwarded-for'];
  const rawIp =
    (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : '') ||
    req.socket.remoteAddress ||
    req.ip ||
    'Unknown';
  const cleanIp = rawIp.replace(/^::ffff:/, '');
  res.json({ ip: cleanIp });
});

// REST API: Heartbeat lightweight ping
app.all('/api/heartbeat', (_req, res) => {
  setNoCache(res);
  res.status(200).json({ ok: true, active: true });
});

// Ensure data directory exists for shared LAN database
const dataDir = path.resolve(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
const dbFilePath = path.resolve(dataDir, 'database.json');

// File DB Reader with Auto-Initialization
function readLocalDatabase(): any {
  try {
    if (fs.existsSync(dbFilePath)) {
      const raw = fs.readFileSync(dbFilePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.employees)) {
        return parsed;
      }
    }
  } catch (err) {
    console.error('Error reading database.json, initializing fallback:', err);
  }
  const initDb = { ...DEFAULT_DB, updatedAt: new Date().toISOString() };
  writeLocalDatabase(initDb);
  return initDb;
}

// Atomic File DB Writer
function writeLocalDatabase(data: any): void {
  const tmpPath = `${dbFilePath}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmpPath, dbFilePath);
}

// REST API: Get shared office attendance database
app.get('/api/db', (_req, res) => {
  setNoCache(res);
  try {
    const current = readLocalDatabase();
    const settings = {
      ...(current.settings || DEFAULT_DB.settings),
      enforceDeviceBinding: false,
    };

    if (Array.isArray(current.attendance)) {
      const { records: displayRecs } = evaluateAttendancePresenceAndAutoClose(
        current.attendance,
        settings,
        current.employees || [],
        current.shifts || []
      );
      return res.status(200).json({
        ...current,
        settings,
        attendance: displayRecs,
      });
    }

    return res.status(200).json({
      ...current,
      settings,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// REST API: Save / Mutate shared office attendance database with Scoped Atomic Merging
app.post('/api/db', (req, res) => {
  setNoCache(res);
  try {
    const incoming = req.body;
    if (!incoming || typeof incoming !== 'object') {
      return res.status(400).json({ error: 'Invalid request body' });
    }

    const current = readLocalDatabase();
    const scope = incoming.scope || 'legacy_bulk';

    let rejectionReason: string | null = null;
    const onReject = (reason: string) => {
      if (!rejectionReason) rejectionReason = reason;
    };

    const hasQueuedAge =
      incoming.queuedAgeMs !== undefined && Number.isFinite(Number(incoming.queuedAgeMs));
    const clampedQueuedAgeMs = hasQueuedAge
      ? Math.max(0, Math.min(24 * 60 * 60 * 1000, Number(incoming.queuedAgeMs)))
      : 0;

    const authoritativeMs = hasQueuedAge ? Date.now() - clampedQueuedAgeMs : Date.now();
    const authoritativeIso = new Date(authoritativeMs).toISOString();
    const mergeOpts = {
      actorRoleFallback: incoming.actorRole,
      authoritativeMs,
      authoritativeIso,
      onReject,
    };

    let finalSettings = current.settings || DEFAULT_DB.settings;
    let finalShifts = Array.isArray(current.shifts) && current.shifts.length > 0 ? current.shifts : DEFAULT_DB.shifts;
    let finalEmployees = Array.isArray(current.employees) ? current.employees : [];
    let rawAttendance = Array.isArray(current.attendance) ? current.attendance : [];
    let finalLeaves = Array.isArray(current.leaves) ? current.leaves : [];
    let finalCeoComments = Array.isArray(current.ceoComments) ? current.ceoComments : [];
    let finalDeletedEmployeeIds: string[] = Array.isArray(current.deletedEmployeeIds) ? current.deletedEmployeeIds : [];
    let finalDeletedLeaveIds: string[] = Array.isArray(current.deletedLeaveIds) ? current.deletedLeaveIds : [];

    if (scope === 'attendance') {
      const attMap = new Map<string, any>(rawAttendance.map((a: any) => [a.id, a]));
      if (Array.isArray(incoming.changedRecords) && incoming.changedRecords.length > 0) {
        for (const rec of incoming.changedRecords) {
          if (rec && rec.id) {
            const merged = mergeAttendanceRecord(attMap.get(rec.id), rec, mergeOpts);
            attMap.set(merged.id, merged);
          }
        }
      } else if (incoming.changedRecord && incoming.changedRecord.id) {
        const merged = mergeAttendanceRecord(
          attMap.get(incoming.changedRecord.id),
          incoming.changedRecord,
          mergeOpts
        );
        attMap.set(merged.id, merged);
      } else if (Array.isArray(incoming.attendance)) {
        for (const a of incoming.attendance) {
          if (a && a.id) {
            const merged = mergeAttendanceRecord(attMap.get(a.id), a, mergeOpts);
            attMap.set(merged.id, merged);
          }
        }
      }
      rawAttendance = Array.from(attMap.values());
    } else if (scope === 'employee_upsert') {
      if (incoming.employee) {
        if (incoming.actorRole === 'admin') {
          finalDeletedEmployeeIds = finalDeletedEmployeeIds.filter((id) => id !== incoming.employee.id);
        }
        finalEmployees = mergeSingleEmployee(
          finalEmployees,
          incoming.employee,
          Boolean(incoming.allowClearDevice),
          Boolean(incoming.clearPendingRequest),
          incoming.actorRole
        );
      }
    } else if (scope === 'employee_delete') {
      const targetId = incoming.deletedEmployeeId || incoming.employeeId;
      if (targetId && targetId !== 'emp-101') {
        finalEmployees = finalEmployees.filter((e: any) => e.id !== targetId);
        finalDeletedEmployeeIds = Array.from(new Set([...finalDeletedEmployeeIds, targetId]));
      } else if (targetId === 'emp-101') {
        rejectionReason = 'Primary Administrator account (emp-101) cannot be deleted.';
      }
    } else if (scope === 'shifts') {
      if (Array.isArray(incoming.shifts) && incoming.shifts.length > 0) {
        finalShifts = incoming.shifts;
      }
    } else if (scope === 'settings') {
      if (incoming.settings) {
        const curSetMs = parseIsoMs(finalSettings?.settingsUpdatedAt);
        const incSetMs = hasQueuedAge
          ? authoritativeMs
          : parseIsoMs(incoming.settings?.settingsUpdatedAt);
        if (curSetMs === 0 || incSetMs === 0 || incSetMs >= curSetMs) {
          finalSettings = {
            ...finalSettings,
            ...incoming.settings,
            enforceDeviceBinding: false,
            settingsUpdatedAt:
              authoritativeIso || incoming.settings.settingsUpdatedAt || new Date().toISOString(),
          };
        }
      }
    } else if (scope === 'leaves') {
      const leaveMap = new Map<string, any>(finalLeaves.map((l: any) => [l.id, l]));
      if (incoming.changedLeave && incoming.changedLeave.id) {
        const existingLeave = leaveMap.get(incoming.changedLeave.id);
        const incLeaveMs = hasQueuedAge
          ? authoritativeMs
          : parseIsoMs(incoming.changedLeave.recordUpdatedAt);
        const existingMs = parseIsoMs(existingLeave?.recordUpdatedAt);
        const existingHasAdminDecision =
          existingLeave &&
          (existingLeave.lastEditedByRole === 'admin' ||
            existingLeave.reviewedBy ||
            existingLeave.status === 'approved' ||
            existingLeave.status === 'rejected');

        const isAllowed =
          !existingLeave ||
          incoming.actorRole === 'admin' ||
          (!existingHasAdminDecision && (incLeaveMs >= existingMs || existingMs === 0));

        if (isAllowed) {
          leaveMap.set(incoming.changedLeave.id, {
            ...(existingLeave || {}),
            ...incoming.changedLeave,
            recordUpdatedAt:
              authoritativeIso || incoming.changedLeave.recordUpdatedAt || new Date().toISOString(),
          });
        } else {
          rejectionReason = existingHasAdminDecision
            ? 'Leave request has already been reviewed by Administrator and cannot be modified.'
            : 'Leave update rejected: Newer revision already exists on server.';
        }
      } else if (Array.isArray(incoming.leaves)) {
        for (const l of incoming.leaves) {
          if (l && l.id) {
            const existingLeave = leaveMap.get(l.id);
            const existingHasAdminDecision =
              existingLeave &&
              (existingLeave.lastEditedByRole === 'admin' ||
                existingLeave.reviewedBy ||
                existingLeave.status === 'approved' ||
                existingLeave.status === 'rejected');

            if (!existingLeave) {
              leaveMap.set(l.id, l);
            } else if (incoming.actorRole === 'admin') {
              leaveMap.set(l.id, { ...existingLeave, ...l });
            } else if (
              !existingHasAdminDecision &&
              parseIsoMs(l.recordUpdatedAt) >= parseIsoMs(existingLeave.recordUpdatedAt)
            ) {
              leaveMap.set(l.id, { ...existingLeave, ...l });
            }
          }
        }
      }
      finalLeaves = Array.from(leaveMap.values());
    } else if (scope === 'ceoComments') {
      const commentMap = new Map<string, any>(finalCeoComments.map((c: any) => [c.id, c]));
      if (incoming.changedComment && incoming.changedComment.id) {
        const existing = commentMap.get(incoming.changedComment.id);
        commentMap.set(
          incoming.changedComment.id,
          existing ? { ...existing, ...incoming.changedComment } : incoming.changedComment
        );
      } else if (Array.isArray(incoming.ceoComments)) {
        for (const c of incoming.ceoComments) {
          if (c && c.id) {
            const existing = commentMap.get(c.id);
            commentMap.set(c.id, existing ? { ...existing, ...c } : c);
          }
        }
      }
      finalCeoComments = Array.from(commentMap.values());
    } else {
      // legacy_bulk safety fallback
      finalEmployees = mergeEmployeesAdditiveSafe(
        finalEmployees,
        incoming.employees,
        finalDeletedEmployeeIds
      );

      const attMap = new Map<string, any>(rawAttendance.map((a: any) => [a.id, a]));
      if (Array.isArray(incoming.attendance)) {
        for (const a of incoming.attendance) {
          if (a && a.id) {
            attMap.set(a.id, mergeAttendanceRecord(attMap.get(a.id), a, { isLegacyBulk: true }));
          }
        }
      }
      rawAttendance = Array.from(attMap.values());

      const leaveMap = new Map<string, any>(finalLeaves.map((l: any) => [l.id, l]));
      if (Array.isArray(incoming.leaves)) {
        for (const l of incoming.leaves) {
          if (l && l.id && !leaveMap.has(l.id) && !finalDeletedLeaveIds.includes(l.id)) {
            leaveMap.set(l.id, l);
          }
        }
      }
      finalLeaves = Array.from(leaveMap.values());

      const commentMap = new Map<string, any>(finalCeoComments.map((c: any) => [c.id, c]));
      if (Array.isArray(incoming.ceoComments)) {
        for (const c of incoming.ceoComments) {
          if (c && c.id && !commentMap.has(c.id)) {
            commentMap.set(c.id, c);
          }
        }
      }
      finalCeoComments = Array.from(commentMap.values());
    }

    if (rejectionReason) {
      return res.status(409).json({ error: rejectionReason });
    }

    const { records: evaluatedAttendance } = evaluateAttendancePresenceAndAutoClose(
      rawAttendance,
      finalSettings,
      finalEmployees,
      finalShifts
    );
    const finalAttendance = rawAttendance.map((orig: any, i: number) => {
      const ev = evaluatedAttendance[i];
      return ev && ev.timeOut && !orig?.timeOut ? ev : orig;
    });

    const nextDb = {
      version: '1.0',
      updatedAt: new Date().toISOString(),
      deletedEmployeeIds: finalDeletedEmployeeIds,
      deletedLeaveIds: finalDeletedLeaveIds,
      settings: finalSettings,
      shifts: finalShifts,
      employees: finalEmployees,
      attendance: finalAttendance,
      leaves: finalLeaves,
      ceoComments: finalCeoComments,
    };

    writeLocalDatabase(nextDb);

    res.status(200).json({
      ok: true,
      updatedAt: nextDb.updatedAt,
      db: nextDb,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// REST API: Windows Startup Auto-Punch Endpoint
app.post('/api/auto-punch', (req, res) => {
  setNoCache(res);
  try {
    const { employeeId, authToken } = req.body || {};
    if (!employeeId || !authToken) {
      return res.status(400).json({ ok: false, message: 'Missing employeeId or authToken' });
    }

    const current = readLocalDatabase();
    const emp = (current.employees || []).find((e: any) => e.id === employeeId);
    if (!emp || emp.isActive === false) {
      return res.status(403).json({ ok: false, message: 'Employee inactive or not found' });
    }

    if (!verifyAutoStartToken(emp, authToken)) {
      return res.status(401).json({ ok: false, message: 'Invalid or expired credentials' });
    }

    res.status(200).json({ ok: true, message: 'Auto-punch verified' });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Software files (installers, scripts) are never served over the web. They are handed out by the administrator only.

// Serve static assets from the dist folder if it exists
const distPath = path.resolve(__dirname, 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));

  // SPA fallback to index.html
  app.get('*', (_req, res) => {
    res.sendFile(path.resolve(distPath, 'index.html'));
  });
} else {
  app.get('*', (_req, res) => {
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Attendance Tracker Server</title>
          <style>
            body { font-family: sans-serif; padding: 40px; text-align: center; background: #0f172a; color: #fff; }
            h1 { color: #38bdf8; }
            code { background: #1e293b; padding: 4px 8px; border-radius: 4px; }
          </style>
        </head>
        <body>
          <h1>Attendance Tracker Windows Server</h1>
          <p>The production build is not yet generated.</p>
          <p>Run <code>npm run build</code> in the server terminal, then restart.</p>
        </body>
      </html>
    `);
  });
}

app.listen(Number(PORT), HOST, () => {
  console.log(`===================================================`);
  console.log(` Office Attendance Tracker Local Windows Server    `);
  console.log(`===================================================`);
  console.log(` Local URL:    http://localhost:${PORT}`);
  console.log(` LAN Network:  http://${HOST}:${PORT}`);
  console.log(` Database:     ${dbFilePath}`);
  console.log(` Mode:         Atomic LAN Mutator (No Overwrites)`);
  console.log(` Ready for office employee and admin access.`);
  console.log(`===================================================`);
});
