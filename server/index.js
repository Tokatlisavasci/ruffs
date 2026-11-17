require('dotenv').config();
const express = require('express');
const cors = require('cors');

// Render'da build dizini çalışma zamanına taşınıyor, ~/.cache taşınmıyor.
// Chromium'u node_modules içine kurarsak her deploy'da yeniden indirmek gerekmez.
if (process.env.RENDER && !process.env.PLAYWRIGHT_BROWSERS_PATH) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = '0';
}

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

// --- TikTok trend videoları (traceryn/tiktok-sdk) ---
// SDK saf ESM olduğu için CommonJS sunucudan dinamik import ile yüklenir.
const TRENDING_TTL_MS = Number(process.env.TIKTOK_TRENDING_TTL_MS) || 10 * 60 * 1000;
let tiktokClient = null;
let tiktokSession = null;
let tiktokSdkPromise = null;
// Sonsuz feed için büyüyen havuz: her istek yeni benzersiz video eklemeye çalışır.
const TRENDING_POOL_MAX = 300;
let trendingPool = { items: [], source: null, updatedAt: 0, growing: null };

async function getTikTokClient() {
  if (tiktokClient) return tiktokClient;
  if (!tiktokSdkPromise) tiktokSdkPromise = import('@traceryn/tiktok-sdk');
  let sdk;
  try {
    sdk = await tiktokSdkPromise;
  } catch (e) {
    tiktokSdkPromise = null;
    throw Object.assign(new Error(`TikTok SDK yüklenemedi: ${e?.message || e}`), { status: 503 });
  }

  if (!tiktokSession && process.env.TIKTOK_USE_SESSION === 'true') {
    try {
      tiktokSession = new sdk.PlaywrightSession({ headless: true });
      await tiktokSession.init();
      console.log('TikTok Playwright session hazır');
    } catch (e) {
      console.warn('TikTok Playwright session başlatılamadı:', e?.message || e);
      tiktokSession = null;
    }
  }

  tiktokClient = new sdk.TikTokClient({
    timeout: Number(process.env.TIKTOK_TIMEOUT_MS) || 15000,
    maxRetries: 1,
    rateLimit: 1,
    concurrency: 1,
    cacheTTL: 60 * 1000,
    ...(tiktokSession ? { session: tiktokSession } : {}),
  });
  return tiktokClient;
}

function firstString(...values) {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v;
    if (Array.isArray(v)) {
      const hit = v.find((x) => typeof x === 'string' && x.trim());
      if (hit) return hit;
    }
  }
  return null;
}

function pickTrendingPlayUrl(raw) {
  const video = raw?.video || {};
  const bitrateUrls = Array.isArray(video?.bitrateInfo)
    ? video.bitrateInfo.map((b) => b?.PlayAddr?.UrlList?.[0] || b?.playAddr?.[0] || b?.playAddr)
    : [];
  return firstString(video?.playAddr, video?.downloadAddr, ...bitrateUrls);
}

function normalizeTrendingVideo(item) {
  // SDK sarmalayıcısı (raw) ya da ham itemList öğesi (explore) gelebilir.
  const raw = item?.raw || item || {};
  const author = raw?.author || {};
  const uniqueId = String(author.uniqueId || '').replace(/^@/, '');
  const id = String(item?.id || '');
  const cover = firstString(item?.cover, raw?.video?.cover, raw?.video?.originCover, raw?.video?.dynamicCover);
  return {
    id,
    desc: String(item?.desc || ''),
    createTime: item?.createTime || null,
    duration: Number(item?.duration ?? raw?.video?.duration ?? 0) || 0,
    stats: {
      views: Number(item?.playCount ?? raw?.stats?.playCount ?? 0),
      likes: Number(item?.diggCount ?? raw?.stats?.diggCount ?? 0),
      comments: Number(item?.commentCount ?? raw?.stats?.commentCount ?? 0),
      shares: Number(raw?.stats?.shareCount ?? 0),
    },
    cover,
    playUrl: pickTrendingPlayUrl(raw),
    webUrl: uniqueId && id ? `https://www.tiktok.com/@${uniqueId}/video/${id}` : null,
    music: raw?.music?.title ? String(raw.music.title) : null,
    author: {
      uniqueId,
      nickname: String(author.nickname || uniqueId || 'TikTok'),
      avatar: firstString(author.avatarThumb, author.avatarMedium, author.avatarLarger, author.avatar),
      verified: !!author.verified,
    },
  };
}

// TikTok'un resmi hesabı (@tiktok) küratörlü çalma listelerinin içeriğini oluşturuyor;
// akışta herkes @tiktok görünmesin diye bu hesabın videoları havuza alınmaz.
function isOfficialTikTokAuthor(video) {
  return String(video?.author?.uniqueId || '').trim().toLowerCase() === 'tiktok';
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} zaman aşımı`)), ms);
    if (timer.unref) timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// --- Başsız Chromium ile gerçek Keşfet (tiktok.com/explore) yanıtları ---
// SDK'nın recommend çağrısı imzalı istek istediği için boş dönebiliyor; o durumda
// explore sayfası tarayıcıda açılır ve ağdan /api/explore/item_list yanıtları yakalanır.
const EXPLORE_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const EXPLORE_URL = 'https://www.tiktok.com/explore';
const FORYOU_URL = 'https://www.tiktok.com/foryou';

function loadPlaywright() {
  try {
    return require('playwright');
  } catch (e) {
    console.warn('playwright yüklü değil (explore stratejisi atlanıyor):', e?.message || e);
    return null;
  }
}

// Deploy sırasında Chromium inmemiş olabilir (build script'i çalışmadı/kısıldı).
// Bu durumda arka planda bir kez indirmeyi dener; o istek playlists'e düşer,
// indirme bitince sonraki istekler explore kullanır.
let chromiumInstall = null;
let chromiumInstallState = 'bilinmiyor';

function ensureChromium(pw) {
  if (process.env.TIKTOK_EXPLORE_AUTOINSTALL === 'false') return null;
  try {
    const execPath = pw.chromium.executablePath();
    if (execPath && require('fs').existsSync(execPath)) return null;
  } catch {
    return null;
  }
  if (chromiumInstall) return chromiumInstall;

  chromiumInstallState = 'indiriliyor';
  console.log('Chromium bulunamadı, `playwright install chromium` başlatılıyor');
  chromiumInstall = new Promise((resolve) => {
    const { spawn } = require('child_process');
    const child = spawn('npx', ['playwright', 'install', 'chromium'], { stdio: 'inherit', shell: process.platform === 'win32' });
    const done = (ok) => {
      chromiumInstallState = ok ? 'hazır' : 'başarısız';
      console.log('playwright install chromium:', chromiumInstallState);
      resolve(ok);
    };
    child.on('exit', (code) => done(code === 0));
    child.on('error', (e) => {
      console.warn('playwright install başlatılamadı:', e?.message || e);
      done(false);
    });
  });
  return chromiumInstall;
}

// Tek bir sayfada (explore/foryou) item_list yanıtlarını yakalar; sabırla indirir.
async function captureItemListPage(pw, url, target, timeoutMs) {
  const browser = await pw.chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const context = await browser.newContext({
      userAgent: EXPLORE_UA,
      locale: 'en-US',
      viewport: { width: 1400, height: 900 },
    });
    const page = await context.newPage();
    // Görsel/font/medya indirmeleri gereksiz; JSON yanıtları yakalamak yeterli.
    await page.route('**/*', (route) => {
      const type = route.request().resourceType();
      if (type === 'image' || type === 'font' || type === 'media') return route.abort();
      return route.continue();
    });

    const collected = new Map();
    page.on('response', (response) => {
      if (!/\/api\/(explore|recommend)\/item_list\//.test(response.url())) return;
      response
        .json()
        .then((data) => {
          for (const item of data?.itemList || []) {
            const v = normalizeTrendingVideo(item);
            if (!v.id || collected.has(v.id)) continue;
            if (!v.cover && !v.playUrl) continue;
            if (isOfficialTikTokAuthor(v)) continue;
            collected.set(v.id, v);
          }
        })
        .catch(() => {});
    });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await page.mouse.move(700, 450).catch(() => {});

    const deadline = Date.now() + timeoutMs;
    let lastScrollAt = 0;
    let lastGainAt = Date.now();
    let seenSoFar = 0;
    // En az 12 video bulana kadar erken çıkmıyoruz; ilk istekler gecikebiliyor.
    const minWanted = Math.min(12, target);

    while (Date.now() < deadline && collected.size < target) {
      await page.waitForTimeout(1200);
      if (collected.size > seenSoFar) {
        seenSoFar = collected.size;
        lastGainAt = Date.now();
      }
      if (collected.size >= target) break;
      if (collected.size >= minWanted && Date.now() - lastGainAt > 18000) break;
      if (Date.now() - lastScrollAt > 2500) {
        lastScrollAt = Date.now();
        await page.mouse.wheel(0, 2400).catch(() => {});
        // Sayfa kendi kaydırma kabını kullanıyorsa onu da kaydır.
        await page
          .evaluate(() => {
            const scrollables = [...document.querySelectorAll('div')]
              .filter((el) => el.scrollHeight > el.clientHeight + 200)
              .sort((a, b) => b.scrollHeight - a.scrollHeight);
            const el = scrollables[0];
            if (el) el.scrollTop = el.scrollTop + el.clientHeight * 0.9;
            else window.scrollBy(0, window.innerHeight * 0.9);
          })
          .catch(() => {});
      }
    }
    await page.waitForTimeout(1500); // yakalanan yanıtların parse edilmesini bekle
    return [...collected.values()].slice(0, target);
  } finally {
    await browser.close().catch(() => {});
  }
}

async function fetchTrendingFromExplore(count = 30) {
  if (process.env.TIKTOK_EXPLORE === 'false') return [];
  const pw = loadPlaywright();
  if (!pw?.chromium) return [];

  // Render'ın paylaşımlı CPU'sunda tarayıcı yavaş; toplam süreyi kısa tutuyoruz.
  const timeoutMs = Math.min(Math.max(Number(process.env.TIKTOK_EXPLORE_TIMEOUT_MS) || 30000, 10000), 60000);
  const target = Math.min(Math.max(count, 12), 50);

  let best = [];
  let lastError = null;
  const pages = [
    [EXPLORE_URL, timeoutMs],
    [FORYOU_URL, Math.max(12000, Math.round(timeoutMs / 2))],
  ];
  for (const [url, pageTimeout] of pages) {
    try {
      const items = await captureItemListPage(pw, url, target, pageTimeout);
      console.log(`TikTok ${url}: ${items.length} video yakalandı`);
      if (items.length > best.length) best = items;
      if (best.length >= Math.min(12, target)) break;
    } catch (e) {
      lastError = e;
      console.warn(`TikTok ${url} başarısız:`, e?.message || e);
    }
  }

  if (best.length) return best.slice(0, count);
  if (lastError) {
    // Eksik Chromium: indirmeyi tetikle, bu istek yedek stratejiye düşsün.
    if (/Executable doesn't exist|browserType\.launch/i.test(String(lastError?.message || ''))) ensureChromium(pw);
    throw lastError;
  }
  return [];
}

async function fetchTrendingFromPlaylists(client, limit = 4) {
  const playlists = await withTimeout(client.getUserPlaylists('tiktok'), 20000, 'playlist listesi');
  const list = Array.isArray(playlists?.playlists) ? playlists.playlists : [];
  const usable = list.filter((p) => p?.id && Number(p?.videoCount) > 0).slice(0, limit);
  if (!usable.length) return [];

  const seen = new Set();
  const items = [];
  // SDK'nın iç kuyruğu paralel isteklerde kilitleniyor; sırayla çekiyoruz.
  for (const p of usable) {
    try {
      const res = await withTimeout(client.getPlaylistVideos(p.id, 0, 30), 25000, `çalma listesi ${p.id}`);
      for (const raw of res?.videos || []) {
        const v = normalizeTrendingVideo(raw);
        if (!v.id || seen.has(v.id)) continue;
        if (!v.cover && !v.playUrl) continue;
        if (isOfficialTikTokAuthor(v)) continue;
        seen.add(v.id);
        items.push(v);
      }
    } catch (e) {
      console.warn('TikTok çalma listesi atlandı:', p?.id, e?.message || e);
    }
  }
  items.sort((a, b) => (b?.stats?.views || 0) - (a?.stats?.views || 0));
  return items;
}

async function fetchRecommendItems(count = 24) {
  const client = await getTikTokClient();
  const result = await withTimeout(client.getTrendingVideos(count), 20000, 'TikTok recommend');
  const list = Array.isArray(result?.videos) ? result.videos : [];
  return list.map(normalizeTrendingVideo).filter((v) => v.id && (v.cover || v.playUrl));
}

// Havuzu hedef sayıya çıkarır: önce Keşfet, yetmezse çalma listeleri.
// Aynı anda tek büyütme çalışır; video yoksa false döner.
async function growTrendingPool(targetItems, diag = null) {
  if (trendingPool.growing) return trendingPool.growing;
  if (trendingPool.items.length >= targetItems && trendingPool.items.length >= 24) return false;

  const task = (async () => {
    const before = trendingPool.items.length;
    const add = (list, source) => {
      const seen = new Set(trendingPool.items.map((v) => v.id));
      for (const v of list || []) {
        if (trendingPool.items.length >= TRENDING_POOL_MAX) break;
        if (!v?.id || seen.has(v.id)) continue;
        if (isOfficialTikTokAuthor(v)) continue;
        seen.add(v.id);
        trendingPool.items.push(v);
      }
      if (!trendingPool.source && trendingPool.items.length > before) trendingPool.source = source;
    };

    // 1) SDK'nın kendi recommend çağrısı (TikTok imza istediği için çoğu zaman boş)
    if (!before) {
      try {
        const recommend = await fetchRecommendItems(Math.min(Math.max(targetItems, 24), 30));
        if (diag) diag.recommend = `${recommend.length} video`;
        add(recommend, 'recommend');
      } catch (e) {
        if (diag) diag.recommend = `hata: ${e?.message || e}`;
      }
    }

    // 2) Başsız Chromium ile gerçek Keşfet yanıtları
    const need = Math.max(targetItems - trendingPool.items.length, 24);
    try {
      const explore = await fetchTrendingFromExplore(Math.min(Math.max(need, 24), 50));
      if (diag) diag.explore = `${explore.length} video`;
      add(explore, 'explore');
    } catch (e) {
      if (diag) diag.explore = `hata: ${e?.message || e}`;
      console.warn('TikTok explore hatası:', e?.message || e);
    }

    // 3) Son çare: TikTok'un küratörlü çalma listeleri (SDK)
    if (trendingPool.items.length < targetItems) {
      try {
        const client = await getTikTokClient();
        const playlists = await fetchTrendingFromPlaylists(client, 3);
        if (diag) diag.playlists = `${playlists.length} video`;
        add(playlists, 'playlists');
      } catch (e) {
        if (diag) diag.playlists = `hata: ${e?.message || e}`;
      }
    }

    trendingPool.updatedAt = Date.now();
    if (diag) diag.pool = trendingPool.items.length;
    return trendingPool.items.length > before;
  })();

  trendingPool.growing = task.finally(() => {
    trendingPool.growing = null;
  });
  return trendingPool.growing;
}

const app = express();
app.use(cors());
app.use(express.json());

const PORT = Number(process.env.PORT) || 4000;

app.get('/health', (req, res) => {
  res.json({ ok: true, provider: 'loops', loopsConfigured: !!loopsConfig() });
});

// Otomatik TikTok trendleri: imleçli (cursor) sonsuz akış.
// Havuz büyüdükçe yeni videolar eklenir; havuz tükenirse başa döner, feed hiç bitmez.
app.get('/trending', async (req, res) => {
  const force = req.query.refresh === '1' || req.query.refresh === 'true';
  const count = Math.min(Math.max(Number(req.query.count) || 12, 1), 30);
  const cursor = Math.max(Number(req.query.cursor) || 0, 0);
  const diag = req.query.debug === '1' ? { chromium: chromiumInstallState } : null;

  if (force) trendingPool = { items: [], source: null, updatedAt: 0, growing: null };

  const stale = Date.now() - trendingPool.updatedAt > TRENDING_TTL_MS;
  const short = cursor + count > trendingPool.items.length;

  try {
    if (!trendingPool.items.length || (stale && cursor === 0)) {
      // Havuz boşsa beklemek zorundayız; yoksa hiç video dönmez.
      await growTrendingPool(Math.max(count * 2, 24), diag);
    } else if (short) {
      // Sayfa tükeniyor: yeni videolar eklemeye çalış ama istemciyi çok bekletme.
      // Büyütme arka planda sürer, sonraki istekler aynı işleme bağlanır.
      await Promise.race([
        growTrendingPool(cursor + count, diag).catch(() => false),
        new Promise((resolve) => setTimeout(resolve, 12000)),
      ]);
    }
  } catch (e) {
    console.warn('TikTok trend havuzu büyütülemedi:', e?.message || e);
  }

  const items = trendingPool.items;
  if (!items.length) {
    return res.status(502).json({
      ok: false,
      error: 'TikTok trend videoları alınamadı (recommend, explore ve çalma listesi yolları boş döndü).',
    });
  }

  let start = cursor;
  let looped = false;
  if (start >= items.length) {
    start = 0;
    looped = true;
  }
  const slice = items.slice(start, start + count);

  return res.json({
    ok: true,
    source: trendingPool.source || 'tiktok',
    looped,
    cursor,
    nextCursor: start + slice.length,
    hasMore: true,
    poolSize: items.length,
    fetchedAt: new Date(trendingPool.updatedAt || Date.now()).toISOString(),
    videos: slice,
    ...(diag ? { debug: diag } : {}),
  });
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




app.listen(PORT, () => {
  console.log(`Ruffs API http://localhost:${PORT} (Loops configured: ${!!loopsConfig()})`);
  // Chromium'u ilk istekte değil, sunucu açılırken indirmeye başla.
  try {
    ensureChromium(loadPlaywright());
  } catch (e) {
    console.warn('Chromium hazırlığı başlatılamadı:', e?.message || e);
  }
});
