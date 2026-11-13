export default function handler(req, res) {
  const forwarded = req.headers['x-forwarded-for'];
  const rawIp =
    (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : '') ||
    req.headers['x-real-ip'] ||
    req.socket?.remoteAddress ||
    'Unknown';
  const cleanIp = String(rawIp).replace(/^::ffff:/, '').trim();
  const asn = req.headers['x-vercel-ip-as-number'] ? `AS${req.headers['x-vercel-ip-as-number']}` : '';
  const city = req.headers['x-vercel-ip-city'] || '';
  const country = req.headers['x-vercel-ip-country'] || '';

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.status(200).json({ ip: cleanIp, asn, city, country });
}
