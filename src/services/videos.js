import {
  collection,
  addDoc,
  query,
  where,
  getDocs,
  orderBy,
  serverTimestamp,
  deleteDoc,
  doc,
} from 'firebase/firestore';
import { Platform } from 'react-native';
import { db, isFirebaseConfigured, auth } from '../config/firebase';
import { API_BASE_URL } from '../api/config';

const IMAGE_EXT = /\.(jpe?g|png|webp|heic|heif|gif)$/i;

export function inferMediaType({ uri, mimeType, explicit } = {}) {
  if (explicit === 'image' || explicit === 'video') return explicit;
  if (mimeType) {
    if (String(mimeType).startsWith('image/')) return 'image';
    if (String(mimeType).startsWith('video/')) return 'video';
  }
  if (IMAGE_EXT.test(String(uri || '').split('?')[0])) return 'image';
  return 'video';
}

function guessType(uri, mediaType) {
  if (mediaType === 'image') {
    const lower = String(uri || '').toLowerCase();
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.webp')) return 'image/webp';
    if (lower.endsWith('.heic') || lower.endsWith('.heif')) return 'image/heic';
    if (lower.endsWith('.gif')) return 'image/gif';
    return 'image/jpeg';
  }
  const lower = String(uri || '').toLowerCase();
  if (lower.endsWith('.mov')) return 'video/quicktime';
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.m4v')) return 'video/x-m4v';
  return 'video/mp4';
}


async function getSignHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  try {
    if (auth?.currentUser?.getIdToken) {
      const token = await auth.currentUser.getIdToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }
  } catch (e) {
    // token alınamazsa body uid ile devam (sadece yerel/dev uyumu); public güvenli endpoint token ister.
  }
  return headers;
}

function guessName(uri, mediaType) {
  const m = String(uri || '').match(/([^/?#]+)(?:\?|#|$)/);
  const name = m ? m[1] : (mediaType === 'image' ? 'photo.jpg' : 'video.mp4');
  if (name.includes('.')) return name;
  return `${name}.${mediaType === 'image' ? 'jpg' : 'mp4'}`;
}

export function deriveVideoPlaybackUrl(url) {
  if (!url || typeof url !== 'string') return null;
  // Cloudinary: mobil için optimize teslim (boyut/bitrate düşür, takılmayı azalt).
  if (url.includes('res.cloudinary.com') && url.includes('/video/upload/')) {
    if (url.includes('/video/upload/q_auto') || url.includes('/video/upload/f_auto') || url.includes('/video/upload/w_')) return url;
    return url.replace('/video/upload/', '/video/upload/q_auto,f_mp4,vc_h264,w_720/');
  }
  return url;
}

export function deriveVideoThumbnail(url) {
  if (!url || typeof url !== 'string') return null;
  // Cloudinary video -> poster frame (jpg). Eski kayıtlarda thumbnailUrl=mp4 olabilir.
  if (url.includes('res.cloudinary.com') && url.includes('/video/upload/')) {
    return url.replace('/video/upload/', '/video/upload/so_0/f_jpg/').replace(/\.[^./?#]+([?#]|$)/, '.jpg$1');
  }
  // Görsel ise kendisi önizleme olarak kullanılabilir.
  if (url.includes('/image/upload/') || IMAGE_EXT.test(url.split('?')[0])) return url;
  return url;
}

function withTimeout(promise, ms, message) {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

function uploadMultipartXHR(url, form, { timeoutMs = 10 * 60 * 1000, headers } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.timeout = timeoutMs;
    if (headers && typeof headers === 'object') {
      Object.entries(headers).forEach(([k, v]) => {
        if (v != null && String(k).toLowerCase() !== 'content-type') xhr.setRequestHeader(k, String(v));
      });
    }
    xhr.onload = () => {
      let data = {};
      try {
        data = JSON.parse(xhr.responseText || '{}');
      } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else {
        const msg = (typeof data?.error === 'string' ? data.error : data?.error?.message) || data?.detail?.error
          || (xhr.responseText && !xhr.responseText.trim().startsWith('{') ? `Yükleme başarısız (HTTP ${xhr.status})` : `Yükleme başarısız (HTTP ${xhr.status})`);
        reject(Object.assign(new Error(msg), { data, status: xhr.status }));
      }
    };
    xhr.onerror = () => reject(new Error('Ağ hatası (yükleme). Bağlantınızı kontrol edin.'));
    xhr.ontimeout = () => reject(new Error('Yükleme zaman aşımına uğradı. Dosya büyük olabilir veya bağlantı yavaş; tekrar deneyin.'));
    xhr.onabort = () => reject(new Error('Yükleme iptal edildi.'));
    xhr.send(form);
  });
}

async function uploadToCloudinary({ uri, sign, mediaType, mimeType }) {
  const form = new FormData();
  if (Platform.OS === 'web') {
    const blobRes = await withTimeout(fetch(uri), 30000, 'Dosya okunamadı (zaman aşımı).');
    const blob = await blobRes.blob();
    form.append('file', blob, guessName(uri, mediaType));
  } else {
    // React Native: XHR + {uri,name,type} dosya parçası.
    form.append('file', {
      uri,
      type: mimeType || guessType(uri, mediaType),
      name: guessName(uri, mediaType),
    });
  }
  form.append('api_key', sign.apiKey);
  form.append('timestamp', String(sign.timestamp));
  form.append('signature', sign.signature);
  form.append('folder', sign.folder);

  if (Platform.OS === 'web') {
    const upRes = await withTimeout(
      fetch(sign.uploadUrl, { method: 'POST', body: form }),
      10 * 60 * 1000,
      'Yükleme zaman aşımına uğradı. Bağlantınızı kontrol edip tekrar deneyin.'
    );
    const upData = await upRes.json().catch(() => ({}));
    if (!upRes.ok) throw new Error(upData?.error?.message || 'Cloudinary yüklemesi başarısız.');
    return upData;
  }
  return await uploadMultipartXHR(sign.uploadUrl, form, { timeoutMs: 10 * 60 * 1000 });
}


async function uploadVideoToLoopsServer({ uri, caption, mediaType, mimeType }) {
  const form = new FormData();
  form.append('description', String(caption || '').slice(0, 200));
  form.append('video', {
    uri,
    name: guessName(uri, mediaType) || 'upload.mp4',
    type: mimeType || 'video/mp4',
  });
  const headers = await getSignHeaders(); // Authorization: Bearer <idToken>
  const data = await uploadMultipartXHR(`${API_BASE_URL}/uploads/video`, form, {
    timeoutMs: 180000,
    headers,
  });
  if (!data?.mediaUrl && !data?.playbackUrl) throw new Error('Loops yanıtından video URL’si alınamadı.');
  return data;
}

export async function uploadUserMedia({ uri, caption, user, mediaType: explicitType, mimeType }) {
  if (!isFirebaseConfigured || !db) throw new Error('Firebase yapılandırılmadı (EXPO_PUBLIC_FIREBASE_*).');
  if (!user?.id) throw new Error('Oturum gerekli');
  if (!uri) throw new Error('Medya seçilmedi');

  const mediaType = inferMediaType({ uri, mimeType, explicit: explicitType });

  // Videolar: loops.video (sunucu üzerinden, token sunucuda). Görseller: mevcut Cloudinary akışı.
  if (mediaType === 'video') {
    let up;
    try {
      up = await uploadVideoToLoopsServer({ uri, caption, mediaType, mimeType });
    } catch (e) {
      if (e?.message && !String(e.message).includes('Network request failed') && !String(e.message).includes('fetch')) throw e;
      throw new Error('Yükleme sunucusuna bağlanılamadı. Render sunucun çalışıyor mu ve EXPO_PUBLIC_SIGNING_API_URL doğru mu?');
    }
    const mediaUrl = up.playbackUrl || up.mediaUrl;
    const thumb = up.thumbnailUrl || deriveVideoThumbnail(mediaUrl) || mediaUrl;
    const docData = {
      uid: user.id,
      username: user.username || '',
      displayName: user.displayName || '',
      avatar: user.avatar || null,
      mediaType: 'video',
      mediaUrl,
      videoUrl: mediaUrl,
      thumbnailUrl: thumb,
      provider: up.provider || 'loops',
      loopsId: up.loopsId || null,
      loopsUrl: up.loopsUrl || null,
      caption: String(caption || '').trim().slice(0, 220),
      likesCount: 0,
      commentsCount: 0,
      sharesCount: 0,
      viewsCount: 0,
      createdAt: serverTimestamp(),
    };
    const ref = await addDoc(collection(db, 'videos'), docData);
    return { id: ref.id, ...docData, createdAt: new Date().toISOString() };
  }

  // (Eski) Cloudinary imzalı yükleme — görseller için; şu an opsiyonel/ertelenmiş.
  let sign;
  try {
    const r = await withTimeout(
      fetch(`${API_BASE_URL}/uploads/sign`, {
        method: 'POST',
        headers: await getSignHeaders(),
        body: JSON.stringify({ uid: user.id, resourceType: mediaType }),
      }),
      15000,
      'İmzalama sunucusu yanıt vermedi. Sunucu çalışıyor mu ve cihaz ağa erişebiliyor mu?'
    );
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data?.error || 'Yükleme hazırlanamadı');
    sign = data;
  } catch (e) {
    if (e?.message && !String(e.message).includes('Network request failed') && !String(e.message).includes('fetch')) throw e;
    throw new Error('Yükleme sunucusuna bağlanılamadı. Cloudinary imzalama sunucusu/ayarları hazır mı?');
  }

  const upData = await uploadToCloudinary({ uri, sign, mediaType, mimeType });
  const rawUrl = upData.secure_url || upData.url;
  const mediaUrl = mediaType === 'video' ? (deriveVideoPlaybackUrl(rawUrl) || rawUrl) : rawUrl;
  if (!mediaUrl) throw new Error('Yükleme tamamlandı ancak medya URL’si alınamadı.');
  const docData = {
    uid: user.id,
    username: user.username || '',
    displayName: user.displayName || '',
    avatar: user.avatar || null,
    mediaType,
    mediaUrl,
    videoUrl: mediaUrl,
    thumbnailUrl: mediaType === 'video' ? (deriveVideoThumbnail(rawUrl) || rawUrl || mediaUrl) : mediaUrl,
    cloudinaryPublicId: upData.public_id || null,
    caption: String(caption || '').trim().slice(0, 220),
    likesCount: 0,
    commentsCount: 0,
    sharesCount: 0,
    viewsCount: 0,
    createdAt: serverTimestamp(),
  };
  const ref = await addDoc(collection(db, 'videos'), docData);
  return { id: ref.id, ...docData, createdAt: new Date().toISOString() };
}

export const uploadUserVideo = uploadUserMedia;

export async function fetchUserVideos(uid) {
  if (!isFirebaseConfigured || !db) return [];
  if (!uid) return [];
  // orderBy + where farklı alanlarda bileşik index isteyebilir; istemci tarafında sıralıyoruz.
  const q = query(collection(db, 'videos'), where('uid', '==', uid));
  const snap = await getDocs(q);
  const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  items.sort((a, b) => {
    const ta = a.createdAt?.toMillis ? a.createdAt.toMillis() : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
    const tb = b.createdAt?.toMillis ? b.createdAt.toMillis() : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
    return tb - ta;
  });
  return items;
}

export async function fetchFeedVideos() {
  if (!isFirebaseConfigured || !db) return [];
  try {
    const q = query(collection(db, 'videos'), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) {
    // orderBy createdAt bazen index/alan durumunda sorun çıkarabilir; fallback: createdAt olmadan çekip sırala.
    const snap = await getDocs(collection(db, 'videos'));
    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    items.sort((a, b) => {
      const ta = a.createdAt?.toMillis ? a.createdAt.toMillis() : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
      const tb = b.createdAt?.toMillis ? b.createdAt.toMillis() : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
      return tb - ta;
    });
    return items;
  }
}


export async function uploadCloudinaryAsset({ uri, userId, mediaType = 'image', mimeType }) {
  if (!uri) throw new Error('Dosya seçilmedi');
  if (!userId) throw new Error('Oturum gerekli');
  let sign;
  try {
    const r = await withTimeout(
      fetch(`${API_BASE_URL}/uploads/sign`, {
        method: 'POST',
        headers: await getSignHeaders(),
        body: JSON.stringify({ uid: userId, resourceType: mediaType }),
      }),
      15000,
      'İmzalama sunucusu yanıt vermedi. Bilgisayarda "tiktok-clone/server" çalışıyor mu ve cihaz aynı ağda mı?'
    );
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data?.error || 'Yükleme hazırlanamadı');
    sign = data;
  } catch (e) {
    if (e?.message && !String(e.message).includes('Network request failed') && !String(e.message).includes('fetch')) throw e;
    throw new Error('Yükleme sunucusuna bağlanılamadı. "tiktok-clone/server" çalışıyor mu ve Cloudinary ayarları (server/.env) tamam mı?');
  }
  const upData = await uploadToCloudinary({ uri, sign, mediaType, mimeType });
  const url = upData.secure_url || upData.url;
  if (!url) throw new Error('Yükleme tamamlandı ancak URL alınamadı.');
  return { url, publicId: upData.public_id || null, raw: upData };
}


export async function deleteUserVideo({ videoId, loopsId, user }) {
  if (!isFirebaseConfigured || !db) throw new Error('Firebase yapılandırılmadı.');
  if (!user?.id) throw new Error('Oturum gerekli');
  if (!videoId) throw new Error('Video bulunamadı');

  // Loops tarafını (varsa) sunucu üzerinden silmeye çalış; başarısız olsa bile Ruffs kaydını sileriz.
  if (loopsId) {
    try {
      const headers = await getSignHeaders();
      await withTimeout(
        fetch(`${API_BASE_URL}/uploads/video/delete`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ videoId, loopsId }),
        }),
        20000,
        'Silme isteği zaman aşımına uğradı.'
      );
    } catch (e) {
      // en iyi çaba: Loops silinemese de uygulamadan kaldır
      console.warn('loops delete (best-effort) failed:', e?.message || e);
    }
  }

  await deleteDoc(doc(db, 'videos', videoId));
  return true;
}
