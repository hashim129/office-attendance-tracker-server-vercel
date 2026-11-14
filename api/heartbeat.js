import { setNoCacheHeaders } from './_cloud.js';

export default async function handler(req, res) {
  setNoCacheHeaders(res);

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const { employeeId } = body;

    if (!employeeId) {
      return res.status(400).json({ ok: false, code: 'INVALID_REQUEST', message: 'Missing employeeId.' });
    }

    // Lightweight heartbeat acknowledgment without burning GitHub write quota
    return res.status(200).json({
      ok: true,
      active: true,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({ ok: false, code: 'SERVER_ERROR', message: String(err) });
  }
}
