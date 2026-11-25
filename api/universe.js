import { getSessionEmployee } from './_session.js';
import { supabaseFetch } from './_supabase.js';
import { CHARACTER_IDS as CHARACTERS } from '../src/lib/universeCharacters.js';

const PETS = new Set(['cat','dog','rabbit','owl','hamster','parrot','turtle','none']);
const PRIVATE_TABLE = 'employee_universe_private_messages';
const recipients = (row) => Array.isArray(row.mention_ids) ? row.mention_ids : [];
export const canSeeUniverseMessage = (row, employeeId) => recipients(row).length === 0 || row.sender_id === employeeId || recipients(row).includes(employeeId);

function response(res, status, payload) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(status).json(payload);
}
function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}
async function requireActor(req) {
  const token = String(req.headers['x-session-token'] || '').trim();
  if (!token) return null;
  const actor = await getSessionEmployee(token);
  return actor && actor.is_active !== false ? actor : null;
}
async function requireBeta() {
  const rows = await supabaseFetch('/settings?id=eq.current&select=data');
  const settings = parseJson(rows?.[0]?.data, {});
  return settings.employeeUniverseBetaEnabled === true;
}
function publicEmployee(row) {
  const pending = parseJson(row.pending_device_request, {});
  return {
    id: row.id,
    name: row.name || 'Employee',
    role: row.role || 'employee',
    characterId: CHARACTERS.has(pending.gameCharacterId) ? pending.gameCharacterId : null,
    petId: PETS.has(pending.gamePetId) && pending.gamePetId !== 'none' ? pending.gamePetId : null,
  };
}

export default async function handler(req, res) {
  try {
    const actor = await requireActor(req);
    if (!actor) return response(res, 401, { error: 'Please sign in again.' });
    if (!(await requireBeta())) return response(res, 403, { error: 'Employee Universe Beta is currently disabled.' });

    if (req.method === 'GET') {
      const suffix = '&select=id,sender_id,body,mention_ids,reply_to,created_at&order=created_at.desc&limit=80';
      const [publicRows, ownRows, legacyPrivateRows, newOwnRows, newPrivateRows] = await Promise.all([
        supabaseFetch('/employee_universe_messages?mention_ids=eq.' + encodeURIComponent('[]') + suffix),
        supabaseFetch('/employee_universe_messages?sender_id=eq.' + encodeURIComponent(actor.id) + suffix),
        supabaseFetch('/employee_universe_messages?mention_ids=cs.' + encodeURIComponent(JSON.stringify([actor.id])) + suffix),
        supabaseFetch(`/${PRIVATE_TABLE}?sender_id=eq.` + encodeURIComponent(actor.id) + suffix),
        supabaseFetch(`/${PRIVATE_TABLE}?mention_ids=cs.` + encodeURIComponent(JSON.stringify([actor.id])) + suffix),
      ]);
      const rows = [...new Map([...(publicRows || []), ...(ownRows || []), ...(legacyPrivateRows || []), ...(newOwnRows || []), ...(newPrivateRows || [])].filter((m) => canSeeUniverseMessage(m, actor.id)).map((m) => [m.id, m])).values()].sort((a,b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0,80);
      const ids = [...new Set((rows || []).flatMap((m) => [m.sender_id, ...(Array.isArray(m.mention_ids) ? m.mention_ids : [])]).filter(Boolean))];
      const employees = ids.length
        ? await supabaseFetch(`/employees?id=in.(${ids.map((id) => encodeURIComponent(id)).join(',')})&deleted_at=is.null&select=id,name,role,pending_device_request`)
        : [];
      const byId = new Map((employees || []).map((e) => [e.id, publicEmployee(e)]));
      return response(res, 200, {
        messages: (rows || []).reverse().map((m) => ({
          id: m.id, body: m.body, sender: byId.get(m.sender_id) || { id: m.sender_id, name: 'Former employee' },
          mentions: (Array.isArray(m.mention_ids) ? m.mention_ids : []).map((id) => byId.get(id)).filter(Boolean),
          private: recipients(m).length > 0, recipientIds: recipients(m), replyTo: rows.some((parent) => parent.id === m.reply_to) ? m.reply_to : null, createdAt: m.created_at,
        })),
      });
    }

    if (req.method !== 'POST') return response(res, 405, { error: 'Method not allowed.' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});

    if (body.action === 'profile') {
      const characterId = String(body.characterId || '');
      const petId = String(body.petId || 'none');
      if (!CHARACTERS.has(characterId)) return response(res, 400, { error: 'Choose a character from the approved gallery.' });
      if (!PETS.has(petId)) return response(res, 400, { error: 'Choose a pet from the approved gallery.' });
      const rows = await supabaseFetch(`/employees?id=eq.${encodeURIComponent(actor.id)}&deleted_at=is.null&select=id,pending_device_request`);
      const row = rows?.[0];
      if (!row) return response(res, 404, { error: 'Employee profile not found.' });
      const pending = parseJson(row.pending_device_request, {});
      const nextPending = { ...pending, gameCharacterId: characterId, gamePetId: petId, gameProfileUpdatedAt: new Date().toISOString() };
      await supabaseFetch(`/employees?id=eq.${encodeURIComponent(actor.id)}&deleted_at=is.null`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ pending_device_request: nextPending, record_updated_at: new Date().toISOString() }),
      });
      return response(res, 200, { ok: true, characterId, petId });
    }

    if (body.action === 'message') {
      const message = String(body.message || '').trim();
      if (!message || message.length > 1500) return response(res, 400, { error: 'Messages must be between 1 and 1,500 characters.' });
      const rawMentions = Array.isArray(body.mentionIds) ? body.mentionIds.map(String) : [];
      const mentionIds = [...new Set(rawMentions.filter((id) => id !== actor.id))];
      if (rawMentions.length && !mentionIds.length || mentionIds.length > 12 || mentionIds.some((id) => !/^[A-Za-z0-9_-]{1,100}$/.test(id))) return response(res, 400, { error: 'Choose valid recipients (up to 12).' });
      let parent = null;
      if (body.replyTo) {
        if (!/^[0-9a-f-]{36}$/i.test(String(body.replyTo))) return response(res, 400, { error: 'Invalid reply.' });
        const query = `?id=eq.${encodeURIComponent(body.replyTo)}&select=id,sender_id,mention_ids`;
        parent = (await supabaseFetch(`/employee_universe_messages${query}`))?.[0] || (await supabaseFetch(`/${PRIVATE_TABLE}${query}`))?.[0];
        if (!parent || !canSeeUniverseMessage(parent, actor.id)) return response(res, 404, { error: 'Referenced message unavailable.' });
        if (recipients(parent).length) {
          const audience = new Set([parent.sender_id, ...recipients(parent)]);
          if (!mentionIds.length || mentionIds.some((id) => !audience.has(id))) return response(res, 400, { error: 'Private replies must stay within the original conversation.' });
        }
      }
      const activeMentions = mentionIds.length
        ? await supabaseFetch(`/employees?id=in.(${mentionIds.map((id) => encodeURIComponent(id)).join(',')})&deleted_at=is.null&is_active=eq.true&select=id`)
        : [];
      const validMentionIds = (activeMentions || []).map((e) => e.id);
      if (validMentionIds.length !== mentionIds.length || mentionIds.some((id) => !validMentionIds.includes(id))) return response(res, 400, { error: 'One or more recipients are unavailable. Nothing was sent.' });
      const recentQuery = `?sender_id=eq.${encodeURIComponent(actor.id)}&created_at=gte.${encodeURIComponent(new Date(Date.now() - 60000).toISOString())}&select=id&limit=15`;
      const [recent, recentPrivate] = await Promise.all([supabaseFetch(`/employee_universe_messages${recentQuery}`), supabaseFetch(`/${PRIVATE_TABLE}${recentQuery}`)]);
      if ((recent || []).length + (recentPrivate || []).length >= 12) return response(res, 429, { error: 'Please wait a moment before sending more messages.' });
      const table = validMentionIds.length ? PRIVATE_TABLE : 'employee_universe_messages';
      const inserted = await supabaseFetch(`/${table}?select=id,sender_id,body,mention_ids,reply_to,created_at`, {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ sender_id: actor.id, body: message, mention_ids: validMentionIds, reply_to: body.replyTo || null }),
      });
      return response(res, 201, { ok: true, messageId: inserted?.[0]?.id });
    }
    return response(res, 400, { error: 'Unknown action.' });
  } catch (err) {
    console.error('employee universe api error:', err);
    return response(res, Number(err?.status) || 500, { error: err?.message || 'Employee Universe is temporarily unavailable.' });
  }
}
