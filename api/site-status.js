import { isSiteDisabled } from './_session.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' });
  try {
    return res.status(200).json({ disabled: await isSiteDisabled() });
  } catch {
    return res.status(503).json({ error: 'Could not check portal availability.' });
  }
}
