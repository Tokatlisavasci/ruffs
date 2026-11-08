require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

let admin = null;
try { admin = require('firebase-admin'); } catch {}
const REQUIRE_AUTH = process.env.REQUIRE_AUTH === 'true';
if (admin && !admin.apps.length) {
  try {
    const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (sa) {
      const creds = typeof sa === 'string' ? JSON.parse(sa) : sa;
      admin.initializeApp({ credential: admin.credential.cert(creds) });
    } else {
      // GOOGLE_APPLICATION_CREDENTIALS veya varsayılan kimlik bilgileri gerekir (public/secure mod için).
      admin.initializeApp();
    }
  } catch (e) {
    console.warn('firebase-admin init skipped:', e?.message || e);
  }
}

const fs = require('fs');
const os = require('os');
const path = require('path');
const multer = require('multer');

const uploadMw = multer({
  dest: path.join(os.tmpdir(), 'ruffs-uploads'),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB; Loops instance limiti ayrıca uygulanır
});

function loopsConfig() {
  const base = (process.env.LOOPS_BASE_URL || 'https://loops.video').replace(/\/$/, '');
  const token = process.env.LOOPS_ACCESS_TOKEN || process.env.LOOPS_BEARER_TOKEN;
  if (!token) return null;
  return { base, token };
}

async function uploadToLoops({ filePath, filename, mimeType, description }) {
  const cfg = loopsConfig();
  if (!cfg) throw Object.assign(new Error('Loops yapılandırılmadı (LOOPS_ACCESS_TOKEN).'), { status: 503 });
  const buf = fs.readFileSync(filePath);
  const form = new FormData();
  form.append('video', new Blob([buf], { type: mimeType || 'video/mp4' }), filename || 'upload.mp4');
  if (description) form.append('description', String(description).slice(0, 200));
  const r = await fetch(`${cfg.base}/api/v1/studio/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/json' },
    body: form,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = data?.error || data?.message || (typeof data === 'string' ? data : null) || `Loops yükleme hatası (${r.status})`;
    throw Object.assign(new Error(msg), { status: r.status, data });
  }
  return data;
}

function pickLoopsMedia(data) {
  // Studio/upload veya video resource farklı şekillerde dönebilir
  const root = (data?.data && typeof data.data === 'object' && !Array.isArray(data.data))
    ? data.data
    : (Array.isArray(data?.data) ? data.data[0] : (data?.video || data));
  const media = root?.media || data?.media || root?.video || {};
  const src = media.src_url || media.url || media.file_url || root?.src_url || root?.video_url || root?.file_url || root?.preview_url
    || (typeof root?.url === 'string' && /\.(mp4|m3u8|mov|webm)(\?|$)/i.test(root.url) ? root.url : null);
  const hls = media.hls_url || root?.hls_url || media.stream_url || root?.stream_url || null;
  const thumb = media.thumbnail || media.thumbnail_url || media.preview_url || root?.thumbnail || root?.thumbnail_url || root?.poster || root?.preview_url || null;
  const id = root?.id || root?.hid || root?.video_id || data?.id || null;
  const loopsUrl = root?.url && /^https?:/i.test(root.url) && !/\.(mp4|m3u8|mov|webm)(\?|$)/i.test(root.url)
    ? root.url
    : (root?.shortcode ? `${(process.env.LOOPS_BASE_URL || 'https://loops.video').replace(/\/$/, '')}/v/${root.shortcode}` : null);
  return { mediaUrl: src || hls, playbackUrl: src || hls, hlsUrl: hls, thumbnailUrl: thumb, loopsId: id, loopsUrl, processing: !!(root?.processing || root?.status === 'processing' || root?.state === 'processing') };
}

async function resolveUid(req) {
  const authz = String(req.headers.authorization || '');
  const token = authz.startsWith('Bearer ') ? authz.slice(7).trim() : null;
  if (token && admin?.apps?.length) {
    try {
      const decoded = await admin.auth().verifyIdToken(token);
      if (decoded?.uid) return { uid: String(decoded.uid), via: 'token' };
    } catch (e) {
      if (REQUIRE_AUTH) throw Object.assign(new Error('Geçersiz oturum'), { status: 401 });
      // token doğrulanamadıysa (yerel/dev) aşağıda body uid'e düşebilir
    }
  }
  if (REQUIRE_AUTH) throw Object.assign(new Error('Oturum gerekli'), { status: 401 });
  const bodyUid = req.body?.uid;
  if (bodyUid && typeof bodyUid === 'string') return { uid: bodyUid, via: 'body-dev' };
  return null;
}

const app = express();
app.use(cors());
app.use(express.json());

const PORT = Number(process.env.PORT) || 4000;

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

app.get('/health', (req, res) => {
  const cfg = cloudinaryConfig();
  res.json({ ok: true, storageConfigured: !!cfg, provider: 'cloudinary', loopsConfigured: !!loopsConfig() });
});

app.post('/uploads/video', (req, res) => {
  uploadMw.single('video')(req, res, async (merr) => {
    const tmp = req.file?.path;
    try {
      if (merr) return res.status(400).json({ error: merr.message || 'Video alınamadı' });
      let uidInfo;
      try { uidInfo = await resolveUid(req); } catch (e) { return res.status(e.status || 401).json({ error: e.message || 'Yetkisiz' }); }
      if (!uidInfo?.uid) return res.status(401).json({ error: 'Oturum gerekli' });
      if (!req.file) return res.status(400).json({ error: 'video dosyası gerekli (multipart alan adı: video)' });

      const caption = req.body?.description || req.body?.caption || '';
      const data = await uploadToLoops({
        filePath: req.file.path,
        filename: req.file.originalname || 'upload.mp4',
        mimeType: req.file.mimetype || 'video/mp4',
        description: caption,
      });
      const picked = pickLoopsMedia(data);
      if (!picked.mediaUrl) {
        try { console.error('loops upload: media url missing', JSON.stringify({ keys: Object.keys(data||{}), data }).slice(0, 6000)); } catch {}
        return res.status(502).json({ error: picked.processing ? 'Video Loops tarafında işleniyor; URL henüz hazır değil. Biraz sonra tekrar dene.' : 'Loops yanıtından video URL’si alınamadı', raw: data });
      }
      return res.json({
        provider: 'loops',
        ...picked,
        rawId: picked.loopsId,
      });
    } catch (e) {
      const status = e?.status || 500;
      return res.status(status).json({ error: e?.message || 'Video yüklenemedi', detail: e?.data || undefined });
    } finally {
      if (tmp) try { fs.unlinkSync(tmp); } catch {}
    }
  });
});

app.post('/uploads/sign', async (req, res) => {
  try {
    const cfg = cloudinaryConfig();
    if (!cfg) {
      return res.status(503).json({
        error: 'Cloudinary yapılandırılmadı. server/.env veya function secret olarak CLOUDINARY_* ekleyin.',
      });
    }
    let uidInfo;
    try { uidInfo = await resolveUid(req); } catch (e) { return res.status(e.status || 401).json({ error: e.message || 'Yetkisiz' }); }
    const { resourceType } = req.body || {};
    if (!uidInfo?.uid) {
      return res.status(400).json({ error: 'uid gerekli (veya geçerli oturum tokenı)' });
    }
    const kind = resourceType === 'image' ? 'image' : 'video';
    const safeUid = String(uidInfo.uid).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128) || 'user';
    const timestamp = Math.round(Date.now() / 1000);
    const base = (cfg.folder || 'ruffs').replace(/\/(videos|images)\/?$/i, '');
    const folder = `${base}/${kind === 'image' ? 'images' : 'videos'}/${safeUid}`;
    const paramsToSign = { folder, timestamp };
    const signature = signParams(paramsToSign, cfg.apiSecret);
    res.json({
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
    res.status(500).json({ error: 'Yükleme imzası oluşturulamadı' });
  }
});

app.listen(PORT, () => {
  const cfg = cloudinaryConfig();
  console.log(`Ruffs upload API http://localhost:${PORT} (Cloudinary configured: ${!!cfg})`);
});
