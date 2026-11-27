// Activity log for sensitive actions (sign-ins, access changes, exports, deletions). Never throws.
import crypto from 'crypto';
import { supabaseFetch } from './_supabase.js';

export function clientIp(req) {
  const h = req?.headers || {};
  return String(h['x-real-ip'] || String(h['x-forwarded-for'] || '').split(',')[0] || '').trim().slice(0, 64);
}

export async function audit(actor, action, detail = '', ip = '') {
  try {
    await supabaseFetch('/audit_log', {
      method: 'POST',
      body: JSON.stringify([{ id: `aud-${crypto.randomUUID()}`, at: new Date().toISOString(), actor_id: actor?.id || null, actor_name: actor?.name || '', action: String(action).slice(0, 60), detail: String(detail || '').slice(0, 600), ip: String(ip || '').slice(0, 64) }]),
    });
  } catch (e) {
    console.error('audit failed', e?.message);
  }
}
