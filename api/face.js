import { isSupabaseConfigured, supabaseFetch } from './_supabase.js';
import { checkAdminPin, migratePlaintextPins } from './_auth.js';
import { getSessionEmployee } from './_session.js';
import {
  FACE_MATCH_DISTANCE, FACE_DUPLICATE_DISTANCE, FACE_AMBIGUITY_MARGIN, bestDistance, closestOther, listTemplates, samplesAreConsistent, checkLock, clearFailures, getTemplate, isValidDescriptor,
  listEnrolledIds, recordFailure, signFacePass,
} from './_face.js';

async function getEmployee(id) {
  const rows = await supabaseFetch(`/employees?id=eq.${encodeURIComponent(id)}&deleted_at=is.null&select=id,role,pin,is_active`);
  return rows?.[0] || null;
}

async function requireAdmin(adminId, adminPin) {
  await migratePlaintextPins();
  return checkAdminPin(String(adminId || ''), String(adminPin ?? '').trim());
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!isSupabaseConfigured()) return res.status(503).json({ error: 'Face scan needs the cloud database.' });
  try {
    if (req.method === 'GET') {
      return res.status(200).json({ ok: true, enrolledIds: await listEnrolledIds() });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const { action, employeeId } = body;
    if (!employeeId || typeof employeeId !== 'string') return res.status(400).json({ error: 'employeeId required' });

    if (action === 'enroll') {
      let enrolledBy;
      if (body.sessionToken && !body.adminPin) {
        // Self-enrollment: a signed-in person enrolls their OWN face, once. Changing or removing it needs the administrator.
        const me = await getSessionEmployee(body.sessionToken);
        if (!me || me.id !== employeeId) {
          return res.status(401).json({ error: 'Please sign in again to enroll your face.', code: 'SESSION_INVALID' });
        }
        const already = await getTemplate(employeeId);
        if (already && already.descriptors.length > 0) {
          return res.status(403).json({ error: 'Your face is already enrolled. Ask the administrator if it must be changed.', code: 'FACE_ALREADY_ENROLLED' });
        }
        enrolledBy = me.id;
      } else {
        enrolledBy = (await requireAdmin(body.adminId, body.adminPin)).id;
      }
      const emp = await getEmployee(employeeId);
      if (!emp) return res.status(404).json({ error: 'Employee not found.' });
      const samples = Array.isArray(body.descriptors) ? body.descriptors : [];
      if (samples.length < 3 || samples.length > 10 || !samples.every(isValidDescriptor)) {
        return res.status(400).json({ error: 'Need 3 to 10 valid face samples.' });
      }
      if (!samplesAreConsistent(samples)) {
        return res.status(400).json({ error: 'The captured photos do not look like one face. Please try again with only this person in front of the camera.', code: 'FACE_INCONSISTENT' });
      }
      // The same face must not be enrolled for two different people (that is how a friend would punch for someone).
      const templates = await listTemplates();
      for (const s of samples) {
        const other = closestOther(s, templates, employeeId);
        if (other.distance <= FACE_DUPLICATE_DISTANCE) {
          const o = await getEmployee(other.employeeId);
          return res.status(409).json({ error: `This face is already enrolled for ${o?.name || 'another employee'}. Each person needs their own face.`, code: 'FACE_DUPLICATE' });
        }
      }
      await supabaseFetch('/face_templates', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify([{
          employee_id: employeeId, descriptors: samples, enrolled_at: new Date().toISOString(),
          enrolled_by: enrolledBy, fail_count: 0, locked_until: null,
        }]),
      });
      if (body.sessionToken && !body.adminPin) {
        // Enrolling just proved who they are (live scan), so hand back a punch pass and skip a second scan.
        const { token, expiresAt } = signFacePass(employeeId);
        return res.status(200).json({ ok: true, token, expiresAt });
      }
      return res.status(200).json({ ok: true });
    }

    if (action === 'remove') {
      await requireAdmin(body.adminId, body.adminPin);
      await supabaseFetch(`/face_templates?employee_id=eq.${encodeURIComponent(employeeId)}`, { method: 'DELETE' });
      return res.status(200).json({ ok: true });
    }

    if (action === 'verify') {
      if (!isValidDescriptor(body.descriptor)) return res.status(400).json({ error: 'Invalid face data.' });
      const key = `lock:verify:${employeeId}`;
      const prev = await checkLock(key);
      const tpl = await getTemplate(employeeId);
      if (!tpl || tpl.descriptors.length === 0) {
        return res.status(404).json({ error: 'No face is enrolled for this employee.', code: 'FACE_NOT_ENROLLED' });
      }
      const d = bestDistance(body.descriptor, tpl.descriptors);
      // A colleague's enrolled face must not be as close (or closer) than the claimed person's: stops look-alikes
      // and anyone scanning for someone else.
      const other = d <= FACE_MATCH_DISTANCE ? closestOther(body.descriptor, await listTemplates(), employeeId) : { distance: Infinity };
      const ambiguous = other.distance <= FACE_MATCH_DISTANCE + 0.1 && other.distance < d + FACE_AMBIGUITY_MARGIN;
      if (d > FACE_MATCH_DISTANCE || ambiguous) {
        await recordFailure(key, prev);
        return res.status(401).json({ error: 'Face did not match.', code: 'FACE_MISMATCH' });
      }
      if (prev) await clearFailures(key);
      const { token, expiresAt } = signFacePass(employeeId);
      return res.status(200).json({ ok: true, token, expiresAt });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('face api error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Face API failed', code: err.code });
  }
}
