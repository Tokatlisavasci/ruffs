require('dotenv').config();
const express = require('express');
const cors = require('cors');

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
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
});

function loopsConfig() {
  const base = (process.env.LOOPS_BASE_URL || 'https://loops.video').replace(/\/$/, '');
  const token = process.env.LOOPS_ACCESS_TOKEN || process.env.LOOPS_BEARER_TOKEN;
  if (!token) return null;
  return { base, token };
}



async function loopsGet(path, token, base) {
  const r = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data?.error?.message || data?.error || `Loops API hatası (${r.status})`), { status: r.status, data });
  return data;
}

function pickVideoIdFromPost(p) {
  if (!p || typeof p !== 'object') return null;
  return p.id || p.video_id || p.videoId || p?.video?.id || null;
}

async function findUploadedLoopsVideo({ base, token, description, attempts = 12, delayMs = 5000 }) {
  const want = String(description || '').trim();
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await loopsGet('/api/v1/studio/posts', token, base);
      const list = Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);
      let hit = null;
      if (want) {
        hit = list.find(p => {
          const cap = String(p?.caption || p?.description || p?.meta?.caption || '').trim();
          return cap && cap === want;
        });
      }
      if (!hit && list.length) hit = list[0]; // en yeni/genel fallback (studio sıralaması genelde yeniden eskiye)
      const id = pickVideoIdFromPost(hit);
      if (id) {
        const full = await loopsGet(`/api/v1/video/${encodeURIComponent(id)}`, token, base);
        const media = pickLoopsMedia(full?.data ? full : { data: full });
        if (media.mediaUrl) return media;
        // studio post içinde medya olabilir
        const media2 = pickLoopsMedia(hit);
        if (media2.mediaUrl) return { ...media2, loopsId: media2.loopsId || id };
      }
    } catch (e) {
      // işleme devam ediyor olabilir; son denemede yüzdür
      if (i === attempts - 1) throw e;
    }
    if (i < attempts - 1) await new Promise(r => setTimeout(r, delayMs));
  }
  return null;
}

async function uploadToLoops({ filePath, filename, mimeType, description }) {
  const cfg = loopsConfig();
  if (!cfg) throw Object.assign(new Error('Loops yapılandırılmadı (LOOPS_ACCESS_TOKEN).'), { status: 503 });
  const isImage = /^image/i.test(String(mimeType || ''));
  const fallbackType = isImage ? 'image/jpeg' : 'video/mp4';
  const fallbackName = isImage ? 'upload.jpg' : 'upload.mp4';
  const buf = fs.readFileSync(filePath);
  const form = new FormData();
  form.append('video', new Blob([buf], { type: mimeType || fallbackType }), filename || fallbackName);
  if (description) form.append('description', String(description).slice(0, 200));
  const r = await fetch(`${cfg.base}/api/v1/studio/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/json' },
    body: form,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const raw = data?.error || data?.message || (typeof data === 'string' ? data : null);
    const msg = (typeof raw === 'object' ? (raw?.message || JSON.stringify(raw)) : raw) || `Loops yükleme hatası (${r.status})`;
    throw Object.assign(new Error(msg), { status: r.status, data });
  }
  return data;
}

function imgbbKey() {
  const k = process.env.IMGBB_API_KEY;
  return k && String(k).trim() ? String(k).trim() : null;
}

async function uploadToImgbb({ filePath, mimeType, filename }) {
  const key = imgbbKey();
  if (!key) throw Object.assign(new Error('Fotoğraf yükleme yapılandırılmadı (IMGBB_API_KEY).'), { status: 503 });
  const buf = fs.readFileSync(filePath);
  const b64 = buf.toString('base64');
  const body = new URLSearchParams();
  body.set('image', b64);
  if (filename) body.set('name', String(filename).replace(/.[^.]+$/, '').slice(0, 80));
  const r = await fetch(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data?.success) {
    const msg = data?.error?.message || data?.status_txt || `imgbb yükleme hatası (${r.status})`;
    throw Object.assign(new Error(msg), { status: r.status, data });
  }
  const url = data?.data?.display_url || data?.data?.url || data?.data?.image?.url;
  if (!url) throw Object.assign(new Error('imgbb URL döndürmedi.'), { status: 502, data });
  return { provider: 'imgbb', mediaUrl: url, thumbnailUrl: data?.data?.thumb?.url || url, raw: data.data };
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

app.get('/health', (req, res) => {
  res.json({ ok: true, provider: 'loops', loopsConfigured: !!loopsConfig() });
});

app.post('/uploads/video', (req, res) => {
  uploadMw.fields([{ name: 'video', maxCount: 1 }, { name: 'image', maxCount: 1 }, { name: 'file', maxCount: 1 }])(req, res, async (merr) => {
    const f = req.files?.video?.[0] || req.files?.image?.[0] || req.files?.file?.[0] || req.file || null;
    const tmp = f?.path;
    try {
      if (merr) return res.status(400).json({ error: merr.message || 'Medya alınamadı' });
      let uidInfo;
      try { uidInfo = await resolveUid(req); } catch (e) { return res.status(e.status || 401).json({ error: e.message || 'Yetkisiz' }); }
      if (!uidInfo?.uid) return res.status(401).json({ error: 'Oturum gerekli' });
      if (!f) return res.status(400).json({ error: 'Medya dosyası gerekli (multipart: video, image veya file)' });

      const caption = req.body?.description || req.body?.caption || '';
      const mimeType = f.mimetype || '';
      const isImage = /^image/i.test(mimeType) || /.(jpe?g|png|webp|heic|heif|gif)$/i.test(String(f.originalname || ''));
      if (isImage) {
        const img = await uploadToImgbb({
          filePath: f.path,
          filename: f.originalname || 'upload.jpg',
          mimeType: mimeType || 'image/jpeg',
        });
        return res.json({
          provider: img.provider || 'imgbb',
          mediaUrl: img.mediaUrl,
          thumbnailUrl: img.thumbnailUrl || img.mediaUrl,
          playbackUrl: img.mediaUrl,
          loopsId: null,
          loopsUrl: null,
          rawId: null,
        });
      }

      const data = await uploadToLoops({
        filePath: f.path,
        filename: f.originalname || 'upload.mp4',
        mimeType: mimeType || 'video/mp4',
        description: caption,
      });
      let picked = pickLoopsMedia(data);
      if (!picked.mediaUrl) {
        const codeOk = data?.error?.code === 'ok' || data?.status === 'ok';
        const cfg = loopsConfig();
        if (codeOk && cfg) {
          try {
            const polled = await findUploadedLoopsVideo({ base: cfg.base, token: cfg.token, description: caption, attempts: 10, delayMs: 5000 });
            if (polled?.mediaUrl) picked = polled;
          } catch (e) {
            try { console.error('loops upload: poll failed', e?.message || e); } catch {}
          }
        }
      }
      if (!picked.mediaUrl) {
        try { console.error('loops upload: media url missing', JSON.stringify({ keys: Object.keys(data||{}), data }).slice(0, 6000)); } catch {}
        return res.status(502).json({ error: picked.processing ? 'Video Loops tarafında işleniyor; URL henüz hazır değil. Biraz sonra tekrar dene.' : 'Loops videoyu aldı ancak işlenmesi/URL oluşması zaman alıyor olabilir. 1-2 dakika sonra profilden kontrol et veya tekrar dene.', raw: data });
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

app.post('/users/follow', async (req, res) => {
  try {
    let uidInfo;
    try { uidInfo = await resolveUid(req); } catch (e) { return res.status(e.status || 401).json({ error: e.message || 'Yetkisiz' }); }
    if (!uidInfo?.uid) return res.status(401).json({ error: 'Oturum gerekli' });
    if (!admin) return res.status(503).json({ error: 'Sunucu yapılandırması eksik (admin)' });

    const { targetUid } = req.body || {};
    if (!targetUid || typeof targetUid !== 'string') return res.status(400).json({ error: 'targetUid gerekli' });
    if (targetUid === uidInfo.uid) return res.status(400).json({ error: 'Kendini takip edemezsin' });

    const db = admin.firestore();
    const followId = `${uidInfo.uid}_${targetUid}`;
    const followRef = db.doc(`follows/${followId}`);
    const meRef = db.doc(`users/${uidInfo.uid}`);
    const targetRef = db.doc(`users/${targetUid}`);

    const result = await db.runTransaction(async (tx) => {
      const [followSnap, meSnap, targetSnap] = await Promise.all([tx.get(followRef), tx.get(meRef), tx.get(targetRef)]);
      if (!targetSnap.exists) throw Object.assign(new Error('Kullanıcı bulunamadı'), { status: 404 });
      const meD = meSnap.exists ? (meSnap.data() || {}) : {};
      const tgD = targetSnap.data() || {};
      const myFollowing = typeof meD.following === 'number' ? meD.following : 0;
      const theirFollowers = typeof tgD.followers === 'number' ? tgD.followers : 0;
      if (followSnap.exists) {
        tx.delete(followRef);
        const nf = Math.max(0, myFollowing - 1);
        const nt = Math.max(0, theirFollowers - 1);
        if (meSnap.exists) tx.update(meRef, { following: nf }); else tx.set(meRef, { following: nf }, { merge: true });
        tx.update(targetRef, { followers: nt });
        return { following: false, myFollowing: nf, theirFollowers: nt };
      } else {
        tx.set(followRef, { followerId: uidInfo.uid, followedId: targetUid, createdAt: admin.firestore.FieldValue.serverTimestamp() });
        const nf = myFollowing + 1;
        const nt = theirFollowers + 1;
        if (meSnap.exists) tx.update(meRef, { following: nf }); else tx.set(meRef, { following: nf }, { merge: true });
        tx.update(targetRef, { followers: nt });
        const notifRef = db.collection('users').doc(targetUid).collection('notifications').doc();
        tx.set(notifRef, {
          type: 'new_follower',
          fromUid: uidInfo.uid,
          fromUsername: meD.username || null,
          fromDisplayName: meD.displayName || null,
          fromAvatar: meD.avatar || meD.photoURL || null,
          read: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return { following: true, myFollowing: nf, theirFollowers: nt };
      }
    });

    return res.json({ ok: true, ...result });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e?.message || 'Takip işlemi başarısız' });
  }
});

app.post('/videos/save', async (req, res) => {
  try {
    let uidInfo;
    try { uidInfo = await resolveUid(req); } catch (e) { return res.status(e.status || 401).json({ error: e.message || 'Yetkisiz' }); }
    if (!uidInfo?.uid) return res.status(401).json({ error: 'Oturum gerekli' });
    if (!admin) return res.status(503).json({ error: 'Sunucu yapılandırması eksik (admin)' });

    const { videoId } = req.body || {};
    if (!videoId || typeof videoId !== 'string') return res.status(400).json({ error: 'videoId gerekli' });

    const db = admin.firestore();
    const saveId = `${videoId}_${uidInfo.uid}`;
    const saveRef = db.doc(`saves/${saveId}`);
    const videoRef = db.doc(`videos/${videoId}`);
    const meRef = db.doc(`users/${uidInfo.uid}`);

    const result = await db.runTransaction(async (tx) => {
      const [saveSnap, videoSnap, meSnap] = await Promise.all([tx.get(saveRef), tx.get(videoRef), tx.get(meRef)]);
      if (!videoSnap.exists) throw Object.assign(new Error('Video bulunamadı'), { status: 404 });
      const vd = videoSnap.data() || {};
      const meD = meSnap.exists ? (meSnap.data() || {}) : {};
      const cur = typeof vd.savesCount === 'number' ? vd.savesCount : 0;
      if (saveSnap.exists) {
        tx.delete(saveRef);
        const next = Math.max(0, cur - 1);
        tx.update(videoRef, { savesCount: next });
        return { saved: false, savesCount: next };
      } else {
        tx.set(saveRef, { uid: uidInfo.uid, videoId, createdAt: admin.firestore.FieldValue.serverTimestamp() });
        const next = cur + 1;
        tx.update(videoRef, { savesCount: next });
        if (vd.uid && vd.uid !== uidInfo.uid) {
          const notifRef = db.collection('users').doc(vd.uid).collection('notifications').doc();
          tx.set(notifRef, {
            type: 'save',
            fromUid: uidInfo.uid,
            fromUsername: meD.username || null,
            fromDisplayName: meD.displayName || null,
            fromAvatar: meD.avatar || meD.photoURL || null,
            videoId,
            videoThumb: vd.thumbnailUrl || vd.mediaUrl || vd.videoUrl || null,
            read: false,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
        return { saved: true, savesCount: next };
      }
    });

    return res.json({ ok: true, ...result });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e?.message || 'Kaydetme işlemi başarısız' });
  }
});

app.post('/videos/view', async (req, res) => {
  try {
    let uidInfo;
    try { uidInfo = await resolveUid(req); } catch (e) { return res.status(e.status || 401).json({ error: e.message || 'Yetkisiz' }); }
    if (!uidInfo?.uid) return res.status(401).json({ error: 'Oturum gerekli' });
    if (!admin) return res.status(503).json({ error: 'Sunucu yapılandırması eksik (admin)' });

    const { videoId } = req.body || {};
    if (!videoId || typeof videoId !== 'string') return res.status(400).json({ error: 'videoId gerekli' });

    const db = admin.firestore();
    const viewId = `${videoId}_${uidInfo.uid}`;
    const viewRef = db.doc(`views/${viewId}`);
    const videoRef = db.doc(`videos/${videoId}`);

    const result = await db.runTransaction(async (tx) => {
      const [viewSnap, videoSnap] = await Promise.all([tx.get(viewRef), tx.get(videoRef)]);
      if (!videoSnap.exists) throw Object.assign(new Error('Video bulunamadı'), { status: 404 });
      const vd = videoSnap.data() || {};
      const cur = typeof vd.viewsCount === 'number' ? vd.viewsCount : 0;
      if (viewSnap.exists) return { counted: false, viewsCount: cur };
      tx.set(viewRef, { uid: uidInfo.uid, videoId, createdAt: admin.firestore.FieldValue.serverTimestamp() });
      const next = cur + 1;
      tx.update(videoRef, { viewsCount: next });
      return { counted: true, viewsCount: next };
    });

    return res.json({ ok: true, ...result });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e?.message || 'İzlenme kaydedilemedi' });
  }
});

app.post('/videos/like', async (req, res) => {
  try {
    let uidInfo;
    try { uidInfo = await resolveUid(req); } catch (e) { return res.status(e.status || 401).json({ error: e.message || 'Yetkisiz' }); }
    if (!uidInfo?.uid) return res.status(401).json({ error: 'Oturum gerekli' });
    if (!admin) return res.status(503).json({ error: 'Sunucu yapılandırması eksik (admin)' });

    const { videoId } = req.body || {};
    if (!videoId || typeof videoId !== 'string') return res.status(400).json({ error: 'videoId gerekli' });

    const db = admin.firestore();
    const likeId = `${videoId}_${uidInfo.uid}`;
    const likeRef = db.doc(`likes/${likeId}`);
    const videoRef = db.doc(`videos/${videoId}`);
    const meRef = db.doc(`users/${uidInfo.uid}`);

    const result = await db.runTransaction(async (tx) => {
      const [likeSnap, videoSnap, meSnap] = await Promise.all([tx.get(likeRef), tx.get(videoRef), tx.get(meRef)]);
      if (!videoSnap.exists) throw Object.assign(new Error('Video bulunamadı'), { status: 404 });
      const vd = videoSnap.data() || {};
      const meD = meSnap.exists ? (meSnap.data() || {}) : {};
      const cur = typeof vd.likesCount === 'number' ? vd.likesCount : 0;
      if (likeSnap.exists) {
        tx.delete(likeRef);
        const next = Math.max(0, cur - 1);
        tx.update(videoRef, { likesCount: next });
        return { liked: false, likesCount: next };
      } else {
        tx.set(likeRef, { uid: uidInfo.uid, videoId, createdAt: admin.firestore.FieldValue.serverTimestamp() });
        const next = cur + 1;
        tx.update(videoRef, { likesCount: next });
        if (vd.uid && vd.uid !== uidInfo.uid) {
          const notifRef = db.collection('users').doc(vd.uid).collection('notifications').doc();
          tx.set(notifRef, {
            type: 'like',
            fromUid: uidInfo.uid,
            fromUsername: meD.username || null,
            fromDisplayName: meD.displayName || null,
            fromAvatar: meD.avatar || meD.photoURL || null,
            videoId,
            videoThumb: vd.thumbnailUrl || vd.mediaUrl || vd.videoUrl || null,
            read: false,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
        return { liked: true, likesCount: next };
      }
    });

    return res.json({ ok: true, ...result });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e?.message || 'Beğeni işlemi başarısız' });
  }
});

app.post('/uploads/video/delete', async (req, res) => {
  try {
    let uidInfo;
    try { uidInfo = await resolveUid(req); } catch (e) { return res.status(e.status || 401).json({ error: e.message || 'Yetkisiz' }); }
    if (!uidInfo?.uid) return res.status(401).json({ error: 'Oturum gerekli' });

    let { videoId, loopsId } = req.body || {};
    // Sahiplik doğrulaması (admin + firestore erişimi varsa)
    if (admin && videoId) {
      try {
        const snap = await admin.firestore().doc(`videos/${videoId}`).get();
        if (snap.exists) {
          const d = snap.data() || {};
          if (d.uid && d.uid !== uidInfo.uid) return res.status(403).json({ error: 'Bu videoyu silme yetkin yok' });
          if (!loopsId && d.loopsId) loopsId = d.loopsId;
        }
      } catch (e) {
        console.warn('delete ownership check skipped:', e?.message || e);
      }
    }

    const cfg = loopsConfig();
    if (loopsId && cfg) {
      const id = encodeURIComponent(String(loopsId));
      const tries = [
        { url: `${cfg.base}/api/v1/video/delete/${id}`, method: 'POST' },
        { url: `${cfg.base}/api/v1/video/${id}`, method: 'DELETE' },
      ];
      let ok = false;
      for (const t of tries) {
        try {
          const r = await fetch(t.url, { method: t.method, headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/json' } });
          const data = await r.json().catch(() => ({}));
          if (r.ok || data?.error?.code === 'ok') { ok = true; break; }
        } catch {}
      }
      if (!ok) console.warn('loops remote delete did not confirm for', loopsId);
    }

    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Silinemedi' });
  }
});


let loopsDiscoverCache = { at: 0, items: [], debug: null };
const LOOPS_DISCOVER_TTL_MS = 10 * 60 * 1000;
const LOOPS_DISCOVER_TAGS = ['music', 'nature', 'travel', 'dog', 'cats'];

function shuffleArr(arr) {
  const a = Array.isArray(arr) ? arr.slice() : [];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function normalizeLoopsDiscoverItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const v = (raw.video && typeof raw.video === 'object') ? raw.video : raw;
  const media = v.media || {};
  const src = media.src_url || media.hls_url || media.mp4_url || v.mediaUrl || v.videoUrl || v.src_url || null;
  if (!src) return null;
  const acc = v.account || v.user || v.profile || {};
  const thumb = media.thumbnail || media.poster || v.thumbnailUrl || v.thumbnail || src;
  const id = v.id ?? raw.id ?? raw.video_id;
  if (!id) return null;
  return {
    id: `loops_${id}`,
    externalId: id,
    provider: 'loops-discover',
    isExternal: true,
    uid: null,
    username: acc.username || acc.acct || acc.name || 'loops',
    displayName: acc.name || acc.display_name || acc.username || 'Loops',
    avatar: acc.avatar || acc.avatar_url || null,
    mediaType: 'video',
    mediaUrl: src,
    videoUrl: src,
    thumbnailUrl: thumb,
    caption: v.caption || v.description || '',
    likesCount: typeof v.likes === 'number' ? v.likes : (typeof v.likes_count === 'number' ? v.likes_count : 0),
    commentsCount: typeof v.comments === 'number' ? v.comments : (typeof v.comments_count === 'number' ? v.comments_count : 0),
    sharesCount: typeof v.shares === 'number' ? v.shares : 0,
    savesCount: typeof v.bookmarks === 'number' ? v.bookmarks : 0,
    viewsCount: 0,
    loopsUrl: v.url || v.link || null,
    createdAt: v.created_at || v.createdAt || null,
  };
}

async function loopsApiGet(cfg, path) {
  const r = await fetch(`${cfg.base}${path}`, {
    headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/json' },
  });
  if (r.status === 429) return { rateLimited: true, ok: false, status: 429, data: null };
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

function loopsList(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.videos)) return data.videos;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.tags)) return data.tags;
  return [];
}

function dedupeDiscover(items) {
  const seen = new Set();
  const out = [];
  for (const it of items || []) {
    const k = String(it?.externalId || it?.id || '');
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}

function matchTagId(tags, wanted) {
  const w = String(wanted || '').replace(/^#/, '').toLowerCase();
  for (const t of tags || []) {
    if (!t || typeof t !== 'object') continue;
    const name = String(t.name || t.slug || t.tag || t.title || '').replace(/^#/, '').toLowerCase();
    if (name && name === w) return t.id ?? t.tag_id ?? t.name ?? t.slug;
  }
  return null;
}

async function fetchLoopsTagFeed(cfg, tagRef, limit = 12) {
  const ref = String(tagRef || '').replace(/^#/, '').trim();
  if (!ref) return { items: [], status: 0 };
  const res = await loopsApiGet(cfg, `/api/v1/explore/tag-feed/${encodeURIComponent(ref)}?limit=${encodeURIComponent(String(Math.min(20, Math.max(1, limit))))}`);
  if (!res.ok) return { items: [], status: res.status };
  return { items: loopsList(res.data).map(normalizeLoopsDiscoverItem).filter(Boolean), status: res.status };
}

async function fetchLoopsRecommendedRaw() {
  const cfg = loopsConfig();
  if (!cfg) return { items: [], status: 0 };
  const res = await loopsApiGet(cfg, '/api/v0/feed/recommended');
  if (!res.ok) return { items: [], status: res.status };
  return { items: loopsList(res.data).map(normalizeLoopsDiscoverItem).filter(Boolean), status: res.status };
}

async function fetchLoopsPreferredTagMix(limit = 20) {
  const cfg = loopsConfig();
  if (!cfg) return { items: [], debug: { reason: 'no_loops_config' } };
  const debug = { tags: LOOPS_DISCOVER_TAGS, tried: [], recommended: 0 };
  try {
    let trending = [];
    const tagsRes = await loopsApiGet(cfg, '/api/v1/explore/tags');
    debug.tagsStatus = tagsRes.status;
    if (tagsRes.ok) trending = loopsList(tagsRes.data);

    const wanted = shuffleArr(LOOPS_DISCOVER_TAGS);
    const out = [];
    for (const tag of wanted) {
      if (out.length >= limit * 2) break;
      const resolved = matchTagId(trending, tag) || tag;
      let r = await fetchLoopsTagFeed(cfg, resolved, 12);
      if (!r.items.length && String(resolved) !== String(tag)) r = await fetchLoopsTagFeed(cfg, tag, 12);
      debug.tried.push({ tag, resolved, status: r.status, count: r.items.length });
      out.push(...r.items);
    }
    let items = dedupeDiscover(out);
    if (!items.length) {
      const rec = await fetchLoopsRecommendedRaw().catch(() => ({ items: [], status: 0 }));
      debug.recommended = rec.items.length;
      debug.recommendedStatus = rec.status;
      items = rec.items;
      debug.fallback = 'recommended';
    }
    return { items, debug };
  } catch (e) {
    return { items: [], debug: { ...debug, error: 'exception' } };
  }
}

async function fetchLoopsDiscover({ limit = 20, force = false } = {}) {
  if (!loopsConfig()) return { items: [], debug: { reason: 'no_loops_config' } };
  const now = Date.now();
  if (!force && loopsDiscoverCache.items.length && (now - loopsDiscoverCache.at) < LOOPS_DISCOVER_TTL_MS) {
    return { items: shuffleArr(loopsDiscoverCache.items).slice(0, limit), debug: loopsDiscoverCache.debug, cached: true };
  }
  let result = await fetchLoopsPreferredTagMix(limit).catch(() => ({ items: [], debug: { error: 'exception' } }));
  let items = dedupeDiscover(result.items || []);
  if (items.length) loopsDiscoverCache = { at: now, items: shuffleArr(items), debug: result.debug };
  else if (force) loopsDiscoverCache = { at: now, items: [], debug: result.debug };
  const pool = items.length ? items : (loopsDiscoverCache.items || []);
  return { items: shuffleArr(pool).slice(0, limit), debug: result.debug || loopsDiscoverCache.debug, cached: false };
}

app.get('/feed/discover', async (req, res) => {
  try {
    let uidInfo;
    try { uidInfo = await resolveUid(req); } catch (e) { return res.status(e.status || 401).json({ error: e.message || 'Yetkisiz' }); }
    if (!uidInfo?.uid) return res.status(401).json({ error: 'Oturum gerekli' });
    const force = req.query?.force === '1' || req.query?.force === 'true' || req.query?.refresh === '1';
    const lim = Math.min(30, Math.max(1, Number(req.query?.limit) || 20));
    const wantDebug = req.query?.debug === '1' || req.query?.debug === 'true';
    const result = await fetchLoopsDiscover({ limit: lim, force }).catch(() => ({ items: [], debug: { error: 'exception' } }));
    const items = Array.isArray(result?.items) ? result.items : [];
    const body = { items };
    if (wantDebug) body.debug = result?.debug || null;
    console.log('[discover]', JSON.stringify({ uid: uidInfo.uid, force, lim, count: items.length, debug: result?.debug || null }));
    return res.json(body);
  } catch (e) {
    return res.status(200).json({ items: [] });
  }
});

app.listen(PORT, () => {
  console.log(`Ruffs API http://localhost:${PORT} (Loops configured: ${!!loopsConfig()})`);
});
