import { getSessionEmployee } from './_session.js';
import { supabaseFetch } from './_supabase.js';
import { CHARACTER_IDS as CHARACTERS } from '../src/lib/universeCharacters.js';

import { validAppearance, wardrobe, roleCanWear, roleCanWearLook } from '../src/lib/avatarWardrobe.js';

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
    characterId: CHARACTERS.has(row.game_character_id || pending.gameCharacterId) ? row.game_character_id || pending.gameCharacterId : null,
    petId: PETS.has(row.game_pet_id || pending.gamePetId) && (row.game_pet_id || pending.gamePetId) !== 'none' ? row.game_pet_id || pending.gamePetId : null,
    appearance: validAppearance(parseJson(row.avatar_appearance, null)) ? parseJson(row.avatar_appearance, null) : null,
  };
}

export default async function handler(req, res) {
  try {
    const actor = await requireActor(req);
    if (!actor) return response(res, 401, { error: 'Please sign in again.' });
    const input=req.method==='POST'?(typeof req.body==='string'?JSON.parse(req.body):req.body)||{}:{};
    // Presence heartbeats always run so a person is never shown as "offline" just because their chat is switched off.
    if (!['profile','presence'].includes(input.action) && req.query?.view !== 'presence' && !actor.isSuperAdmin && actor.featureAccess?.['employee-universe'] === false) return response(res, 403, { error: 'Your Super Admin has disabled access to Employee Universe.' });
    const beta=await requireBeta();
    if (!beta && (input.action!=='profile' || !input.profile || input.appearance || input.characterId || input.petId)) return response(res, 403, { error: 'Employee Universe Beta is currently disabled.' });

    if (req.method === 'GET' && req.query?.view === 'presence') {
      const profile = parseJson(actor.pending_device_request);
      if (!['admin','ceo'].includes(actor.role) && !profile?.liveDashboardAccess) {
        return response(res, 403, {error:'Live dashboard access required.'});
      }
      const since = new Date(Date.now() - 50000).toISOString();
      const rows = await supabaseFetch('/employee_universe_presence?last_seen=gte.' + encodeURIComponent(since) + '&select=employee_id');
      return response(res, 200, {online:(rows || []).map(row => row.employee_id)});
    }
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
        ? await supabaseFetch(`/employees?id=in.(${ids.map((id) => encodeURIComponent(id)).join(',')})&deleted_at=is.null&select=id,name,role,pending_device_request,game_character_id,game_pet_id,avatar_appearance`)
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

    if(body.action==='presence'){
      await supabaseFetch('/employee_universe_presence?on_conflict=employee_id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({employee_id:actor.id,last_seen:new Date().toISOString()})});
      return response(res,200,{ok:true});
    }

    if (body.action === 'profile') {
      if (!actor.isSuperAdmin && actor.featureAccess?.['employee-profile'] === false) return response(res, 403, { error: 'Your Super Admin has disabled access to My Profile.' });
      const characterId = String(body.characterId || '');
      const petId = String(body.petId || 'none');
      if (beta && !CHARACTERS.has(characterId)) return response(res, 400, { error: 'Choose a character from the approved gallery.' });
      if (!PETS.has(petId)) return response(res, 400, { error: 'Choose a pet from the approved gallery.' });
      if (body.appearance !== undefined && !validAppearance(body.appearance)) return response(res,400,{error:'Invalid avatar options.'});
      if (body.photo !== undefined && !wardrobe.photo.includes(String(body.photo))) return response(res,400,{error:'Choose a profile picture from the gallery.'});
      const role = String(actor.role || 'employee');
      if (body.appearance && !roleCanWearLook(role, body.appearance, actor.isSuperAdmin === true)) return response(res,403,{error:'Some avatar items are reserved for Admin, CEO or Accounts only.'});
      if (body.photo !== undefined && !roleCanWear(role, 'photo', String(body.photo), actor.isSuperAdmin === true)) return response(res,403,{error:'That profile picture is reserved for another role.'});
      const profile = body.profile && typeof body.profile === 'object' ? body.profile : {};
      const name = String(profile.name || actor.name || '').trim();
      const email = String(profile.email || actor.email || '').trim();
      const phone = String(profile.phone || actor.phone || '').trim();
      const department = String(profile.department || actor.department || '').trim();
      const designation = String(profile.designation || actor.designation || '').trim();
      if (!name || name.length > 100 || email.length > 254 || phone.length > 40 || department.length > 100 || designation.length > 100) {
        return response(res, 400, { error: 'Check the profile fields and try again.' });
      }
      const rows = await supabaseFetch(`/employees?id=eq.${encodeURIComponent(actor.id)}&deleted_at=is.null&select=id,avatar_appearance`);
      if (!rows?.[0]) return response(res, 404, { error: 'Employee profile not found.' });
      const now = new Date().toISOString();
      // The 3D look is saved only while the Beta is on; a profile picture can always be saved.
      const currentLook = parseJson(rows[0].avatar_appearance, {}) || {};
      let nextLook = beta && body.appearance ? { ...body.appearance } : null;
      if (body.photo !== undefined) nextLook = { ...(nextLook || currentLook), photo: String(body.photo) };
      await supabaseFetch(`/employees?id=eq.${encodeURIComponent(actor.id)}&deleted_at=is.null`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({name,email,phone,department,designation,...(beta?{game_character_id:characterId,game_pet_id:petId==='none'?null:petId}:{}),...(nextLook?{avatar_appearance:nextLook}:{}),record_updated_at:now}),
      });
      return response(res, 200, { ok: true, characterId, petId, profile:{name,email,phone,department,designation} });
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
