const crypto = require('crypto');
const admin = require('firebase-admin');

function initAdmin() {
  if (admin.apps.length) return;
  const json = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (json) {
    try {
      const creds = typeof json === 'string' ? JSON.parse(json) : json;
      admin.initializeApp({ credential: admin.credential.cert(creds) });
      return;
    } catch (e) {
      console.error('FIREBASE_SERVICE_ACCOUNT parse/init error', e);
    }
  }
  // Fallback (Vercel/GCP ortamlarında ADC varsa). Yoksa token doğrulaması yapılamaz.
  try { admin.initializeApp(); } catch (e) { console.error('admin init error', e); }
}

function cloudinaryConfig() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  const folder = process.env.CLOUDINARY_FOLDER || 'ruffs';
  if (!cloudName || !apiKey || !apiSecret) return null;
  return { cloudName, apiKey, apiSecret, folder };
}

function signParams(paramsToSign, apiSecret) {
  const sorted = Object.keys(paramsToSign)
    .sort()
    .map((k) => `${k}=${paramsToSign[k]}`)
    .join('&');
  return crypto.createHash('sha1').update(sorted + apiSecret).digest('hex');
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method === 'GET') {
    const cfg = cloudinaryConfig();
    return res.status(200).json({ ok: true, storageConfigured: !!cfg, provider: 'cloudinary', secure: true });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const cfg = cloudinaryConfig();
    if (!cfg) return res.status(503).json({ error: 'Cloudinary yapılandırılmadı (Vercel env: CLOUDINARY_*).' });

    initAdmin();
    const authz = String(req.headers.authorization || '');
    const token = authz.startsWith('Bearer ') ? authz.slice(7).trim() : null;
    if (!token) return res.status(401).json({ error: 'Oturum gerekli (geçerli Firebase ID token)' });

    let uid;
    try {
      const decoded = await admin.auth().verifyIdToken(token);
      uid = decoded?.uid ? String(decoded.uid) : null;
    } catch (e) {
      return res.status(401).json({ error: 'Geçersiz oturum' });
    }
    if (!uid) return res.status(401).json({ error: 'Oturum gerekli' });

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { resourceType } = body;
    const kind = resourceType === 'image' ? 'image' : 'video';
    const safeUid = uid.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128) || 'user';
    const timestamp = Math.round(Date.now() / 1000);
    const base = (cfg.folder || 'ruffs').replace(/\/(videos|images)\/?$/i, '');
    const folder = `${base}/${kind === 'image' ? 'images' : 'videos'}/${safeUid}`;
    const paramsToSign = { folder, timestamp };
    const signature = signParams(paramsToSign, cfg.apiSecret);
    return res.status(200).json({
      provider: 'cloudinary',
      resourceType: kind,
      cloudName: cfg.cloudName,
      apiKey: cfg.apiKey,
      timestamp,
      folder,
      signature,
      uploadUrl: `https://api.cloudinary.com/v1_1/${cfg.cloudName}/${kind}/upload`,
    });
  } catch (e) {
    console.error('sign error', e);
    return res.status(500).json({ error: 'Yükleme imzası oluşturulamadı' });
  }
};
