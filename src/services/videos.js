import {
  collection,
  getDoc,
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
  return url;
}

export function deriveVideoThumbnail(url) {
  if (!url || typeof url !== 'string') return null;
  if (IMAGE_EXT.test(url.split('?')[0])) return url;
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


async function uploadMediaToLoopsServer({ uri, caption, mediaType, mimeType }) {
  const mt = mediaType === 'image' ? 'image' : 'video';
  const form = new FormData();
  form.append('description', String(caption || '').slice(0, 200));
  form.append('video', {
    uri,
    name: guessName(uri, mt) || (mt === 'image' ? 'upload.jpg' : 'upload.mp4'),
    type: mimeType || guessType(uri, mt),
  });
  const headers = await getSignHeaders(); // Authorization: Bearer <idToken>
  const data = await uploadMultipartXHR(`${API_BASE_URL}/uploads/video`, form, {
    timeoutMs: 180000,
    headers,
  });
  if (!data?.mediaUrl && !data?.playbackUrl) throw new Error(mt === 'image' ? 'Loops yanıtından fotoğraf URL’si alınamadı.' : 'Loops yanıtından video URL’si alınamadı.');
  return data;
}

export async function uploadUserMedia({ uri, caption, user, mediaType: explicitType, mimeType }) {
  if (!isFirebaseConfigured || !db) throw new Error('Firebase yapılandırılmadı (EXPO_PUBLIC_FIREBASE_*).');
  if (!user?.id) throw new Error('Oturum gerekli');
  if (!uri) throw new Error('Medya seçilmedi');

  const mediaType = inferMediaType({ uri, mimeType, explicit: explicitType });
  let up;
  try {
    up = await uploadMediaToLoopsServer({ uri, caption, mediaType, mimeType });
  } catch (e) {
    if (e?.message && !String(e.message).includes('Network request failed') && !String(e.message).includes('fetch')) throw e;
    throw new Error('Yükleme sunucusuna bağlanılamadı. Render sunucun çalışıyor mu ve EXPO_PUBLIC_SIGNING_API_URL doğru mu?');
  }
  const mediaUrl = up.playbackUrl || up.mediaUrl;
  const thumb = up.thumbnailUrl || (mediaType === 'image' ? mediaUrl : deriveVideoThumbnail(mediaUrl) || mediaUrl);
  if (!mediaUrl) throw new Error('Yükleme tamamlandı ancak medya URL’si alınamadı.');
  const docData = {
    uid: user.id,
    username: user.username || '',
    displayName: user.displayName || '',
    avatar: user.avatar || null,
    mediaType,
    mediaUrl,
    videoUrl: mediaUrl,
    thumbnailUrl: thumb || mediaUrl,
    provider: up.provider || 'loops',
    loopsId: up.loopsId || null,
    loopsUrl: up.loopsUrl || null,
    caption: String(caption || '').trim().slice(0, 220),
    likesCount: 0,
    commentsCount: 0,
    sharesCount: 0,
    savesCount: 0,
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


export async function uploadMediaAsset({ uri, userId, mediaType = 'image', mimeType, caption = '' }) {
  if (!uri) throw new Error('Dosya seçilmedi');
  if (!userId) throw new Error('Oturum gerekli');
  let data;
  try {
    data = await uploadMediaToLoopsServer({ uri, caption, mediaType, mimeType });
  } catch (e) {
    if (e?.message && !String(e.message).includes('Network request failed') && !String(e.message).includes('fetch')) throw e;
    throw new Error('Yükleme sunucusuna bağlanılamadı. Render sunucun çalışıyor mu ve EXPO_PUBLIC_SIGNING_API_URL doğru mu?');
  }
  const url = data?.mediaUrl || data?.playbackUrl || data?.thumbnailUrl;
  if (!url) throw new Error('Yükleme tamamlandı ancak URL alınamadı.');
  return { url, publicId: data?.loopsId || null, raw: data };
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


export async function toggleVideoLike(videoId) {
  const headers = await getSignHeaders();
  const r = await withTimeout(
    fetch(`${API_BASE_URL}/videos/like`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ videoId }),
    }),
    15000,
    'Beğeni isteği zaman aşımına uğradı.'
  );
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data?.ok) throw new Error(data?.error || `Beğeni başarısız (HTTP ${r.status})`);
  return { liked: !!data.liked, likesCount: typeof data.likesCount === 'number' ? data.likesCount : 0 };
}

export async function fetchMyLikedIds(uid) {
  if (!isFirebaseConfigured || !db || !uid) return new Set();
  try {
    const q = query(collection(db, 'likes'), where('uid', '==', uid));
    const snap = await getDocs(q);
    const ids = new Set();
    snap.forEach((d) => { const vid = d.data()?.videoId; if (vid) ids.add(vid); });
    return ids;
  } catch (e) {
    console.warn('fetchMyLikedIds failed', e?.message || e);
    return new Set();
  }
}

export async function fetchLikedVideos(uid) {
  if (!isFirebaseConfigured || !db || !uid) return [];
  try {
    const q = query(collection(db, 'likes'), where('uid', '==', uid));
    const snap = await getDocs(q);
    const likes = [];
    snap.forEach((d) => likes.push({ id: d.id, ...d.data() }));
    likes.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    const out = [];
    for (const lk of likes) {
      if (!lk.videoId) continue;
      try {
        const vs = await getDoc(doc(db, 'videos', lk.videoId));
        if (vs.exists()) out.push({ id: vs.id, ...vs.data(), isLiked: true });
      } catch {}
    }
    return out;
  } catch (e) {
    console.warn('fetchLikedVideos failed', e?.message || e);
    return [];
  }
}


export async function recordVideoView(videoId) {
  if (!videoId) return null;
  try {
    const headers = await getSignHeaders();
    const r = await fetch(`${API_BASE_URL}/videos/view`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ videoId }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data?.ok) return null;
    return { counted: !!data.counted, viewsCount: typeof data.viewsCount === 'number' ? data.viewsCount : null };
  } catch {
    return null;
  }
}


export async function toggleVideoSave(videoId) {
  const headers = await getSignHeaders();
  const r = await withTimeout(
    fetch(`${API_BASE_URL}/videos/save`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ videoId }),
    }),
    15000,
    'Kaydetme isteği zaman aşımına uğradı.'
  );
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data?.ok) throw new Error(data?.error || `Kaydetme başarısız (HTTP ${r.status})`);
  return { saved: !!data.saved, savesCount: typeof data.savesCount === 'number' ? data.savesCount : undefined };
}

export async function fetchMySavedIds(uid) {
  if (!isFirebaseConfigured || !db || !uid) return new Set();
  try {
    const q = query(collection(db, 'saves'), where('uid', '==', uid));
    const snap = await getDocs(q);
    const ids = new Set();
    snap.forEach((d) => { const vid = d.data()?.videoId; if (vid) ids.add(vid); });
    return ids;
  } catch (e) {
    console.warn('fetchMySavedIds failed', e?.message || e);
    return new Set();
  }
}

export async function fetchSavedVideos(uid) {
  if (!isFirebaseConfigured || !db || !uid) return [];
  try {
    const q = query(collection(db, 'saves'), where('uid', '==', uid));
    const snap = await getDocs(q);
    const saves = [];
    snap.forEach((d) => saves.push({ id: d.id, ...d.data() }));
    saves.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    const out = [];
    for (const sv of saves) {
      if (!sv.videoId) continue;
      try {
        const vs = await getDoc(doc(db, 'videos', sv.videoId));
        if (vs.exists()) out.push({ id: vs.id, ...vs.data(), isBookmarked: true });
      } catch {}
    }
    return out;
  } catch (e) {
    console.warn('fetchSavedVideos failed', e?.message || e);
    return [];
  }
}


export async function toggleFollow(targetUid) {
  const headers = await getSignHeaders();
  const r = await withTimeout(
    fetch(`${API_BASE_URL}/users/follow`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ targetUid }),
    }),
    15000,
    'Takip isteği zaman aşımına uğradı.'
  );
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data?.ok) throw new Error(data?.error || `Takip başarısız (HTTP ${r.status})`);
  return { following: !!data.following, myFollowing: data.myFollowing, theirFollowers: data.theirFollowers };
}

export async function fetchMyFollowingIds(uid) {
  if (!isFirebaseConfigured || !db || !uid) return new Set();
  try {
    const q = query(collection(db, 'follows'), where('followerId', '==', uid));
    const snap = await getDocs(q);
    const ids = new Set();
    snap.forEach((d) => { const tid = d.data()?.followedId; if (tid) ids.add(tid); });
    return ids;
  } catch (e) {
    console.warn('fetchMyFollowingIds failed', e?.message || e);
    return new Set();
  }
}


export async function fetchUserProfile(uid) {
  if (!isFirebaseConfigured || !db || !uid) return null;
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() };
  } catch (e) {
    console.warn('fetchUserProfile failed', e?.message || e);
    return null;
  }
}
