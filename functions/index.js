const crypto = require('crypto');
const cors = require('cors')({ origin: true });
const admin = require('firebase-admin');
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');

if (!admin.apps.length) admin.initializeApp();

const CLOUDINARY_CLOUD_NAME = defineSecret('CLOUDINARY_CLOUD_NAME');
const CLOUDINARY_API_KEY = defineSecret('CLOUDINARY_API_KEY');
const CLOUDINARY_API_SECRET = defineSecret('CLOUDINARY_API_SECRET');
const CLOUDINARY_FOLDER = defineSecret('CLOUDINARY_FOLDER');

function cloudinaryConfig() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME || CLOUDINARY_CLOUD_NAME.value();
  const apiKey = process.env.CLOUDINARY_API_KEY || CLOUDINARY_API_KEY.value();
  const apiSecret = process.env.CLOUDINARY_API_SECRET || CLOUDINARY_API_SECRET.value();
  const folder = process.env.CLOUDINARY_FOLDER || CLOUDINARY_FOLDER.value() || 'ruffs';
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

async function verifyUid(req) {
  const authz = String(req.headers.authorization || '');
  const token = authz.startsWith('Bearer ') ? authz.slice(7).trim() : null;
  if (!token) return null;
  const decoded = await admin.auth().verifyIdToken(token);
  return decoded?.uid ? String(decoded.uid) : null;
}

function handleSign(req, res) {
  cors(req, res, async () => {
    try {
      if (req.method === 'OPTIONS') return res.status(204).send('');
      if (req.method === 'GET' && (req.path === '/health' || req.path === '/' || !req.path)) {
        const cfg = cloudinaryConfig();
        return res.json({ ok: true, storageConfigured: !!cfg, provider: 'cloudinary', secure: true });
      }
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

      const cfg = cloudinaryConfig();
      if (!cfg) return res.status(503).json({ error: 'Cloudinary yapılandırılmadı (CLOUDINARY_* secrets).' });

      let uid;
      try { uid = await verifyUid(req); } catch (e) { logger.warn('verifyIdToken failed', e); }
      if (!uid) return res.status(401).json({ error: 'Oturum gerekli (geçerli Firebase ID token)' });

      const { resourceType } = req.body || {};
      const kind = resourceType === 'image' ? 'image' : 'video';
      const safeUid = uid.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128) || 'user';
      const timestamp = Math.round(Date.now() / 1000);
      const base = (cfg.folder || 'ruffs').replace(//(videos|images)/?$/i, '');
      const folder = `${base}/${kind === 'image' ? 'images' : 'videos'}/${safeUid}`;
      const paramsToSign = { folder, timestamp };
      const signature = signParams(paramsToSign, cfg.apiSecret);
      return res.json({
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
      logger.error('sign error', e);
      return res.status(500).json({ error: 'Yükleme imzası oluşturulamadı' });
    }
  });
}

const opts = {
  cors: true,
  region: 'us-central1',
  secrets: [CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, CLOUDINARY_FOLDER],
};

// Deploy sonrası URL (örnek): https://us-central1-PROJECT_ID.cloudfunctions.net/uploadsSign
// Uygulamada: EXPO_PUBLIC_SIGNING_API_URL=https://us-central1-PROJECT_ID.cloudfunctions.net/uploadsSign
exports.uploadsSign = onRequest(opts, handleSign);
exports.api = onRequest(opts, handleSign);
