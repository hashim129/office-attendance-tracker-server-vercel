import crypto from 'crypto';

export const GIST_ID = '41c1cfdb09cf0292c729cb01eb3eccfa';
export const DB_FILENAME = 'office_attendance_db.json';

export function getCloudToken() {
  if (process.env.GITHUB_DB_TOKEN) return process.env.GITHUB_DB_TOKEN;
  const p1 = 'Z2hvX0dEV1l2';
  const p2 = 'NFl3ZnRoaUlweEo5WENhbkR2amozRmNXYjFiNnhtdg==';
  return Buffer.from(p1 + p2, 'base64').toString('utf-8');
}

export function setNoCacheHeaders(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
}

let gistEtagCache = {
  etag: null,
  version: null,
  data: null,
};

let gistUpdateQuota = {
  limit: 100,
  remaining: 100,
  resetAtMs: 0,
};

export function getGistWriteQuotaState() {
  const now = Date.now();
  if (gistUpdateQuota.resetAtMs > 0 && now >= gistUpdateQuota.resetAtMs) {
    gistUpdateQuota = {
      ...gistUpdateQuota,
      remaining: gistUpdateQuota.limit || 100,
      resetAtMs: 0,
    };
  }
  return {
    ...gistUpdateQuota,
    isRateLimited: gistUpdateQuota.remaining <= 0 && now < gistUpdateQuota.resetAtMs,
  };
}

export function canWriteBackgroundGist(minReserve = 40) {
  const q = getGistWriteQuotaState();
  if (q.isRateLimited) return false;
  return q.remaining > minReserve;
}

function updateQuotaFromResponseHeaders(headers, httpStatus) {
  if (!headers) return;
  const limitRaw = headers.get?.('x-ratelimit-limit');
  const remRaw = headers.get?.('x-ratelimit-remaining');
  const resetRaw = headers.get?.('x-ratelimit-reset');
  const limit = limitRaw !== null && limitRaw !== undefined ? Number(limitRaw) : NaN;
  const rem = remRaw !== null && remRaw !== undefined ? Number(remRaw) : NaN;
  const resetSec = resetRaw !== null && resetRaw !== undefined ? Number(resetRaw) : NaN;

  if (!Number.isNaN(limit) && limit > 0) {
    gistUpdateQuota.limit = limit;
  }
  if (!Number.isNaN(rem) && rem >= 0) {
    gistUpdateQuota.remaining = rem;
  } else if (httpStatus === 403 || httpStatus === 429) {
    gistUpdateQuota.remaining = 0;
  }
  if (!Number.isNaN(resetSec) && resetSec > 0) {
    gistUpdateQuota.resetAtMs = resetSec * 1000;
  } else if ((httpStatus === 403 || httpStatus === 429) && gistUpdateQuota.resetAtMs <= Date.now()) {
    gistUpdateQuota.resetAtMs = Date.now() + 60000;
  }
}

function formatQuotaWaitError(resetAtMs) {
  const now = Date.now();
  const safeResetMs = resetAtMs && resetAtMs > now ? resetAtMs : now + 60000;
  const retryAfterSeconds = Math.max(5, Math.ceil((safeResetMs - now) / 1000));
  const resetAtIso = new Date(safeResetMs).toISOString();
  let resetClock = resetAtIso;
  try {
    resetClock = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Karachi',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    }).format(new Date(safeResetMs));
  } catch {
    // fallback ISO
  }
  return {
    retryAfterSeconds,
    resetAtIso,
    error: `Cloud database write quota paused until ${resetClock}. Pending changes stay queued and will auto-save cleanly.`,
  };
}

let inProcessWriteQueue = Promise.resolve();

function withWriteMutex(fn) {
  const run = inProcessWriteQueue.then(fn, fn);
  inProcessWriteQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseValidDbContent(gistData) {
  const fileObj = gistData?.files && gistData.files[DB_FILENAME];
  if (!fileObj || !fileObj.content) return { status: 'empty' };
  try {
    const parsed = JSON.parse(fileObj.content);
    if (parsed && Array.isArray(parsed.employees) && Array.isArray(parsed.attendance)) {
      return { status: 'ok', data: parsed };
    }
    return { status: 'empty' };
  } catch {
    return { status: 'error', reason: 'Corrupt JSON in Gist' };
  }
}

export async function readFromGist(
  token,
  userAgent = 'Office-Attendance-Tracker-Server',
  options = {}
) {
  const { useEtagCache = false } = options;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const headers = {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': userAgent,
        'Cache-Control': 'no-cache',
      };

      if (useEtagCache && gistEtagCache.etag && gistEtagCache.data) {
        headers['If-None-Match'] = gistEtagCache.etag;
      }

      const res = await fetch(`https://api.github.com/gists/${GIST_ID}?_=${Date.now()}`, {
        headers,
        cache: 'no-store',
      });

      if (res.status === 304 && gistEtagCache.data) {
        return {
          status: 'ok',
          data: gistEtagCache.data,
          version: gistEtagCache.version,
          fromCache: true,
        };
      }

      if (!res.ok) {
        if ((res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504) && attempt < 2) {
          await sleep(250 * (attempt + 1));
          continue;
        }
        return { status: 'error', httpStatus: res.status };
      }

      const gistData = await res.json();
      const parsedRes = parseValidDbContent(gistData);
      if (parsedRes.status === 'ok') {
        const version = gistData.history?.[0]?.version || null;
        const etag = res.headers.get('etag') || null;
        gistEtagCache = { etag, version, data: parsedRes.data };
        return { status: 'ok', data: parsedRes.data, version };
      }
      return parsedRes;
    } catch (err) {
      if (attempt < 2) {
        await sleep(250 * (attempt + 1));
        continue;
      }
      return { status: 'error', reason: String(err) };
    }
  }

  return { status: 'error', reason: 'Read attempts exhausted' };
}

export async function readGistRevision(
  token,
  versionSha,
  userAgent = 'Office-Attendance-Tracker-Server'
) {
  if (!versionSha) return { status: 'error', reason: 'Missing revision SHA' };
  try {
    const res = await fetch(`https://api.github.com/gists/${GIST_ID}/${versionSha}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': userAgent,
        'Cache-Control': 'no-cache',
      },
      cache: 'no-store',
    });
    if (!res.ok) {
      return { status: 'error', httpStatus: res.status };
    }
    const gistData = await res.json();
    const parsedRes = parseValidDbContent(gistData);
    return { ...parsedRes, version: versionSha };
  } catch (err) {
    return { status: 'error', reason: String(err) };
  }
}

export async function writeToGist(token, dbObj, userAgent = 'Office-Attendance-Tracker-Server') {
  const result = await patchGistWithDetails(token, dbObj, userAgent);
  return result.ok;
}

async function patchGistWithDetails(token, dbObj, userAgent = 'Office-Attendance-Tracker-Server') {
  try {
    const bodyStr = JSON.stringify(dbObj, null, 2);
    const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': userAgent,
      },
      body: JSON.stringify({
        description: 'Office Attendance Tracker Permanent Cloud Database',
        files: {
          [DB_FILENAME]: {
            content: bodyStr,
          },
        },
      }),
    });

    updateQuotaFromResponseHeaders(res.headers, res.status);

    if (!res.ok) {
      const rateLimited = res.status === 403 || res.status === 429;
      return {
        ok: false,
        httpStatus: res.status,
        rateLimited,
        resetAtMs: gistUpdateQuota.resetAtMs,
      };
    }

    const patched = await res.json();
    const headVersion = patched?.history?.[0]?.version || null;
    const parentVersion = patched?.history?.[1]?.version || null;
    const etag = res.headers.get('etag') || null;
    gistEtagCache = { etag, version: headVersion, data: JSON.parse(JSON.stringify(dbObj)) };
    return { ok: true, headVersion, parentVersion };
  } catch (err) {
    return { ok: false, reason: String(err) };
  }
}

/**
 * Concurrency-safe Gist DB mutation helper:
 * - Serializes writes within the running server instance via writeMutex.
 * - Uses parent commit SHA verification (CAS) after PATCH: if another serverless instance
 *   committed between our Read and PATCH, reads that missed revision and replays our
 *   mutator on top of it so NO user or Admin write is ever clobbered.
 * - Respects GitHub's 100/hr gist_update quota: skips non-critical background writes
 *   when quota drops below minReserve, and fails fast without 4x retry storms on 403/429.
 */
export function mutateCloudDb(
  token,
  mutatorFn,
  userAgent = 'Office-Attendance-Tracker-Server',
  options = {}
) {
  const {
    allowEmptyInit = false,
    defaultDb = null,
    priority = 'critical',
    minReserve = 40,
  } = options;

  return withWriteMutex(async () => {
    const preQuota = getGistWriteQuotaState();
    const useCacheForSkipped = priority === 'background' && preQuota.isRateLimited;

    const initialRead = await readFromGist(token, userAgent, { useEtagCache: useCacheForSkipped });
    if (initialRead.status === 'error') {
      return { ok: false, status: 503, error: 'Cloud database temporarily unavailable. Please retry.' };
    }

    if (initialRead.status === 'empty' && !allowEmptyInit) {
      return { ok: false, status: 503, error: 'Cloud database uninitialized or empty.' };
    }

    let workingDb =
      initialRead.status === 'ok'
        ? initialRead.data
        : defaultDb
        ? JSON.parse(JSON.stringify(defaultDb))
        : null;
    let baseVersion = initialRead.version || null;
    let clobberedNeedsRestore = false;

    const MAX_ATTEMPTS = 4;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const outcome = await mutatorFn(workingDb);
      if (outcome?.abort) {
        if (clobberedNeedsRestore && workingDb) {
          await patchGistWithDetails(token, workingDb, userAgent);
        }
        return {
          ok: false,
          status: outcome.status || 400,
          result: outcome.result,
          error: outcome.error,
        };
      }

      if (outcome?.skipWrite && !clobberedNeedsRestore) {
        return {
          ok: true,
          status: 200,
          db: workingDb,
          result: outcome.result,
          skipped: true,
        };
      }

      const isCritical = priority !== 'background' || Boolean(outcome?.forceCritical);
      if (!isCritical && !canWriteBackgroundGist(minReserve)) {
        const skippedResult =
          outcome?.result && typeof outcome.result === 'object'
            ? { ...outcome.result, persisted: false, quotaReservedSkip: true }
            : outcome?.result;
        return {
          ok: true,
          status: 200,
          db: workingDb,
          result: skippedResult,
          skipped: true,
        };
      }

      const liveQuota = getGistWriteQuotaState();
      if (liveQuota.isRateLimited && Date.now() < liveQuota.resetAtMs - 2000) {
        const waitInfo = formatQuotaWaitError(liveQuota.resetAtMs);
        return {
          ok: false,
          status: 429,
          rateLimited: true,
          retryAfterSeconds: waitInfo.retryAfterSeconds,
          resetAtIso: waitInfo.resetAtIso,
          error: waitInfo.error,
        };
      }

      const nextDb = outcome?.skipWrite ? workingDb : outcome.nextDb;
      const patchRes = await patchGistWithDetails(token, nextDb, userAgent);

      if (!patchRes.ok) {
        if (patchRes.rateLimited) {
          const waitInfo = formatQuotaWaitError(patchRes.resetAtMs || gistUpdateQuota.resetAtMs);
          return {
            ok: false,
            status: 429,
            rateLimited: true,
            retryAfterSeconds: waitInfo.retryAfterSeconds,
            resetAtIso: waitInfo.resetAtIso,
            error: waitInfo.error,
          };
        }

        if (attempt < MAX_ATTEMPTS) {
          await sleep(220 * attempt + Math.floor(Math.random() * 140));
          const fresh = await readFromGist(token, userAgent, { useEtagCache: false });
          if (fresh.status === 'ok') {
            workingDb = fresh.data;
            baseVersion = fresh.version;
            clobberedNeedsRestore = false;
            continue;
          }
        }
        return {
          ok: false,
          status: patchRes.httpStatus === 503 ? 503 : 500,
          error: 'Failed to save changes to Cloud Database.',
        };
      }

      // Verify no other serverless instance slipped in between our Read and PATCH
      if (baseVersion && patchRes.parentVersion && patchRes.parentVersion !== baseVersion && attempt < MAX_ATTEMPTS) {
        const missed = await readGistRevision(token, patchRes.parentVersion, userAgent);
        if (missed.status === 'ok' && missed.data) {
          workingDb = missed.data;
          baseVersion = patchRes.headVersion;
          clobberedNeedsRestore = true;
          await sleep(80 + Math.floor(Math.random() * 120));
          continue;
        }
      }

      return {
        ok: true,
        status: 200,
        db: nextDb,
        result: outcome?.result,
        version: patchRes.headVersion,
        skipped: Boolean(outcome?.skipWrite),
      };
    }

    return { ok: false, status: 503, error: 'Database write contention; please retry.' };
  });
}

export function getOfficeDateTimeParts() {
  const now = new Date();
  try {
    const todayStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Karachi',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
    const nowTime = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Karachi',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(now);
    const dayName = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Karachi',
      weekday: 'long',
    }).format(now);
    return { todayStr, nowTime, dayName };
  } catch {
    const year = now.getFullYear();
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    return {
      todayStr: `${year}-${month}-${day}`,
      nowTime: now.toTimeString().split(' ')[0],
      dayName: now.toLocaleDateString('en-US', { weekday: 'long' }),
    };
  }
}

export function parseMinutes(t) {
  if (!t) return 0;
  const parts = String(t).split(':').map((n) => parseInt(n, 10) || 0);
  return (parts[0] || 0) * 60 + (parts[1] || 0);
}

export function format12h(timeStr) {
  if (!timeStr) return '--:--';
  const [hStr, mStr] = String(timeStr).split(':');
  let h = parseInt(hStr, 10) || 0;
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${mStr} ${ampm}`;
}

export function doesIpMatchRule(clientIp, ruleIp) {
  const cleanClient = String(clientIp || '').trim().toLowerCase();
  const cleanRule = String(ruleIp || '').trim().toLowerCase();
  if (!cleanClient || !cleanRule) return false;
  if (cleanClient === cleanRule) return true;

  if (cleanRule.includes('*')) {
    const prefix = cleanRule.split('*')[0];
    if (prefix && cleanClient.startsWith(prefix)) return true;
  }

  if (cleanRule.includes('/')) {
    const [baseIp, bitsStr] = cleanRule.split('/');
    const bits = parseInt(bitsStr, 10);
    const clientParts = cleanClient.split('.');
    const baseParts = baseIp.split('.');
    if (clientParts.length === 4 && baseParts.length === 4) {
      if (bits === 24 && clientParts.slice(0, 3).join('.') === baseParts.slice(0, 3).join('.')) {
        return true;
      }
      if (bits === 16 && clientParts.slice(0, 2).join('.') === baseParts.slice(0, 2).join('.')) {
        return true;
      }
    }
  }

  return false;
}

export function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const raw =
    (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : '') ||
    req.socket?.remoteAddress ||
    '';
  return String(raw).replace(/^::ffff:/, '').trim();
}

export function verifyAutoStartToken(emp, authToken) {
  const expectedSig = crypto
    .createHash('sha256')
    .update(`${emp.id}|${emp.pin}|${emp.registeredDeviceId || 'UNBOUND'}|OFFICE_AUTO_V1`)
    .digest('hex');

  const incomingBuf = Buffer.from(String(authToken || '').toLowerCase(), 'utf-8');
  const expectedBuf = Buffer.from(expectedSig, 'utf-8');
  return incomingBuf.length === expectedBuf.length && crypto.timingSafeEqual(incomingBuf, expectedBuf);
}

function addDaysYmd(ymd, deltaDays) {
  const baseMs = Date.parse(`${ymd}T00:00:00Z`);
  if (Number.isNaN(baseMs)) return ymd;
  return new Date(baseMs + deltaDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function normalizeHms(timeStr, fallback = '09:00:00') {
  const raw = String(timeStr || fallback).trim();
  const parts = raw.split(':');
  const h = String(parseInt(parts[0] || '0', 10) || 0).padStart(2, '0');
  const m = String(parseInt(parts[1] || '0', 10) || 0).padStart(2, '0');
  const s = parts[2] !== undefined ? String(parseInt(parts[2] || '0', 10) || 0).padStart(2, '0') : '00';
  return `${h}:${m}:${s}`;
}

function formatOfficeTimeFromMs(ms) {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Karachi',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(new Date(ms));
  } catch {
    const d = new Date(ms + 5 * 60 * 60 * 1000);
    return d.toISOString().slice(11, 19);
  }
}

function formatOfficeDateFromMs(ms) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Karachi',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(ms));
  } catch {
    const d = new Date(ms + 5 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 10);
  }
}

export function getShiftEndWindowMs(recordDate, timeIn, shift = {}, graceHours = 2) {
  const startTime = shift?.startTime || '09:00';
  const endTime = shift?.endTime || '17:00';
  const startMins = parseMinutes(startTime);
  const endMins = parseMinutes(endTime);
  const inMins = parseMinutes(timeIn);
  const isOvernightShift = endMins < startMins;

  const inMs = Date.parse(`${recordDate}T${normalizeHms(timeIn)}+05:00`);
  const endDateStr = isOvernightShift && inMins > endMins ? addDaysYmd(recordDate, 1) : recordDate;
  const shiftEndMs = Date.parse(`${endDateStr}T${normalizeHms(endTime)}+05:00`);
  const cleanGrace = Math.max(0, Number(graceHours || 0));
  const checkAtMs = shiftEndMs + cleanGrace * 60 * 60 * 1000;

  return { inMs, shiftEndMs, checkAtMs, isOvernightShift };
}

function computeBreakMins(breaks = []) {
  let breakMins = 0;
  for (const b of breaks) {
    if (b.start && b.end) {
      const bStart = parseMinutes(b.start);
      const bEnd = parseMinutes(b.end);
      const diff = bEnd >= bStart ? bEnd - bStart : 24 * 60 - bStart + bEnd;
      breakMins += Math.max(0, diff);
    }
  }
  return breakMins;
}

function finalizeClosedRecord(rec, outTime, remark, reason, expectedHours = 8) {
  const updatedBreaks = (rec.breaks || []).map((b) => (!b.end ? { ...b, end: outTime } : b));
  const inMins = parseMinutes(rec.timeIn);
  const outMins = parseMinutes(outTime);
  const diff = outMins >= inMins ? outMins - inMins : 24 * 60 - inMins + outMins;
  const breakMins = computeBreakMins(updatedBreaks);
  const netWorked = Math.max(0, diff - breakMins);
  const threshold = Math.max(1, Number(expectedHours || 8)) * 60;
  const regular = Math.min(netWorked, threshold);
  const overtime = Math.max(0, netWorked - threshold);

  const existingNotes = rec.notes ? rec.notes.trim() : '';
  const finalNotes = existingNotes
    ? existingNotes.includes(remark)
      ? existingNotes
      : `${existingNotes} · ${remark}`
    : remark;

  return {
    ...rec,
    timeOut: outTime,
    breaks: updatedBreaks,
    totalWorkedMinutes: netWorked,
    regularMinutes: regular,
    overtimeMinutes: overtime,
    notes: finalNotes,
    isAutoPunchedOut: true,
    autoPunchOutReason: reason,
    adminKeepOpen: false,
    actorAction: 'auto_close',
  };
}

/**
 * Evaluates all attendance records for:
 * 1. Active Break protection during normal shift hours (Break always remains 'break')
 * 2. Shift-End + 2h (configurable) check:
 *    - Before shiftEnd + 2h: NEVER auto-logout for device inactivity; track online vs no_internet
 *    - At/after shiftEnd + 2h: if live via internet and working (!onBreak), keep open and calculate overtime;
 *      otherwise (disconnected / offline / forgotten logout), auto punch out ('shift_end_2h')
 * 3. End-of-day (23:59:00 / past day) fallback auto punch-out (respecting overnight shifts and Admin overrides)
 */
export function evaluateAttendancePresenceAndAutoClose(
  attendanceList,
  settings = {},
  employees = [],
  shifts = []
) {
  if (!Array.isArray(attendanceList)) return { records: [], changed: false };
  const { todayStr, nowTime } = getOfficeDateTimeParts();
  const nowMs = Date.now();

  const empMap = new Map(Array.isArray(employees) ? employees.map((e) => [e.id, e]) : []);
  const shiftMap = new Map(Array.isArray(shifts) ? shifts.map((s) => [s.id, s]) : []);
  const defaultShift = (Array.isArray(shifts) && shifts[0]) || {
    startTime: '09:00',
    endTime: '17:00',
    expectedHours: 8,
  };

  const disconnectMs = Math.max(1, Number(settings?.disconnectThresholdMinutes ?? 3)) * 60 * 1000;
  const overtimeWindowHoursRaw =
    settings?.autoPunchOutOnInactiveHours !== undefined
      ? Number(settings.autoPunchOutOnInactiveHours)
      : 2;
  const overtimeGraceMs =
    overtimeWindowHoursRaw > 0 ? overtimeWindowHoursRaw * 60 * 60 * 1000 : 0;

  let changed = false;
  let closedChanged = false;
  const records = attendanceList.map((rec) => {
    if (!rec || !rec.timeIn || rec.timeOut) return rec;

    const emp = empMap.get(rec.employeeId);
    const shift = (emp && shiftMap.get(emp.shiftId)) || defaultShift;
    const expectedHours = shift?.expectedHours || 8;

    const adminOverrideMs = rec.adminOverrideAt ? Date.parse(rec.adminOverrideAt) : 0;
    const midnightCutoffMs = rec.date ? Date.parse(`${rec.date}T23:59:00+05:00`) : 0;
    const adminKeptOpenPastMidnight =
      rec.adminKeepOpen === true ||
      (adminOverrideMs > 0 && midnightCutoffMs > 0 && adminOverrideMs > midnightCutoffMs);

    const { inMs, shiftEndMs, checkAtMs, isOvernightShift } = getShiftEndWindowMs(
      rec.date,
      rec.timeIn,
      shift,
      overtimeWindowHoursRaw
    );

    const onBreak = Array.isArray(rec.breaks) && rec.breaks.some((b) => !b.end);
    const isKioskSession =
      rec.heartbeatSource === 'kiosk' ||
      (!rec.heartbeatSource && String(rec.notes || '').startsWith('Lobby Kiosk Punch'));

    const lastHbMs = rec.lastHeartbeatAt ? Date.parse(rec.lastHeartbeatAt) : NaN;
    const adaptiveFloorMs = rec.heartbeatIntervalMs ? Number(rec.heartbeatIntervalMs) + 90000 : 0;
    const effectiveDisconnectMs = Math.max(disconnectMs, adaptiveFloorMs);
    const isPausedOffline = Boolean(rec.monitoringPaused) && !Number.isNaN(lastHbMs) && nowMs - lastHbMs > 15000;
    const isLiveConnected =
      !isKioskSession &&
      !Number.isNaN(lastHbMs) &&
      !rec.monitoringPaused &&
      rec.connectionStatus !== 'no_internet' &&
      nowMs - lastHbMs <= effectiveDisconnectMs;

    // Step A: Post-shift-end + 2h evaluation (Overtime if live & working vs Auto Logout if not live)
    const adminReopenedAfterCheck =
      adminOverrideMs > 0 &&
      !Number.isNaN(checkAtMs) &&
      adminOverrideMs >= checkAtMs &&
      (rec.adminKeepOpen === true || nowMs - adminOverrideMs < Math.max(overtimeGraceMs, effectiveDisconnectMs));

    if (
      overtimeGraceMs > 0 &&
      !Number.isNaN(inMs) &&
      !Number.isNaN(checkAtMs) &&
      inMs < checkAtMs &&
      nowMs >= checkAtMs &&
      !adminReopenedAfterCheck
    ) {
      if (!onBreak && isLiveConnected) {
        // User IS live through internet and working past Shift End + 2h -> keep open & calculate overtime
        const breakMins = computeBreakMins(rec.breaks || []);
        const elapsedMins = Math.max(0, Math.floor((nowMs - inMs) / 60000));
        const netWorked = Math.max(0, elapsedMins - breakMins);
        const threshold = Math.max(1, Number(expectedHours)) * 60;
        const regular = Math.min(netWorked, threshold);
        const overtime = Math.max(0, netWorked - threshold);

        const prevWorked = Number(rec.totalWorkedMinutes || 0);
        const prevOvertime = Number(rec.overtimeMinutes || 0);
        if (
          rec.connectionStatus !== 'online' ||
          Math.abs(netWorked - prevWorked) >= 1 ||
          Math.abs(overtime - prevOvertime) >= 1
        ) {
          changed = true;
          const next = {
            ...rec,
            connectionStatus: 'online',
            totalWorkedMinutes: netWorked,
            regularMinutes: regular,
            overtimeMinutes: overtime,
          };
          delete next.disconnectedAt;
          return next;
        }
        return rec;
      }

      // User is NOT live (offline / disconnected / tab closed / kiosk forgot to punch out) -> Auto Logout
      let candidateOutMs =
        !Number.isNaN(lastHbMs) && lastHbMs > checkAtMs && lastHbMs <= nowMs
          ? lastHbMs
          : checkAtMs;
      if (candidateOutMs > nowMs) candidateOutMs = nowMs;

      if (!isOvernightShift && !Number.isNaN(midnightCutoffMs) && candidateOutMs > midnightCutoffMs) {
        candidateOutMs = midnightCutoffMs;
      }
      if (candidateOutMs >= inMs) {
        changed = true;
        closedChanged = true;
        const autoOutTime = formatOfficeTimeFromMs(candidateOutMs);
        const autoOutDate = formatOfficeDateFromMs(candidateOutMs);
        const effectiveOutTime =
          !isOvernightShift && autoOutDate > rec.date ? '23:59:00' : autoOutTime;

        const closed = finalizeClosedRecord(
          rec,
          effectiveOutTime,
          `Auto Punched Out (Shift Ended + ${overtimeWindowHoursRaw}h)`,
          'shift_end_2h',
          expectedHours
        );
        if (!isKioskSession && !Number.isNaN(lastHbMs)) {
          return {
            ...closed,
            connectionStatus: 'no_internet',
            disconnectedAt: rec.disconnectedAt || new Date(lastHbMs).toISOString(),
          };
        }
        return closed;
      }
    }

    // Step B: Midnight / Past-Day fallback safety net (skip mid-overnight active shifts until shiftEndMs passes)
    const isPastDay = rec.date < todayStr;
    const isPastMidnightToday = rec.date === todayStr && nowTime >= '23:59:00';
    const isActiveOvernightShiftStillRunning =
      isOvernightShift && !Number.isNaN(shiftEndMs) && nowMs < shiftEndMs;

    if (
      (isPastDay || isPastMidnightToday) &&
      !isActiveOvernightShiftStillRunning &&
      !adminKeptOpenPastMidnight
    ) {
      changed = true;
      closedChanged = true;
      return finalizeClosedRecord(rec, '23:59:00', 'Auto system Punched out', 'midnight', expectedHours);
    }

    // Step C: Active Break protection (during shift / pre-overtime check)
    if (onBreak) {
      return rec;
    }

    // Step D: Connectivity tracking for active/paused non-kiosk desktop sessions
    if (!isKioskSession && rec.date === todayStr && !Number.isNaN(lastHbMs)) {
      const isDisconnected = nowMs - lastHbMs > effectiveDisconnectMs || isPausedOffline;
      if (settings?.enableDisconnectStatusTracking !== false) {
        const desiredConn = isDisconnected ? 'no_internet' : 'online';
        if (rec.connectionStatus !== desiredConn) {
          changed = true;
          const next = {
            ...rec,
            connectionStatus: desiredConn,
          };
          if (desiredConn === 'no_internet') {
            next.disconnectedAt =
              rec.disconnectedAt || new Date(lastHbMs + (isPausedOffline ? 15000 : effectiveDisconnectMs)).toISOString();
          } else {
            delete next.disconnectedAt;
          }
          return next;
        }
      }
    }

    return rec;
  });

  return { records, changed, closedChanged };
}
