// İmzalama API tabanı.
// - Public/üretim (önerilen): EXPO_PUBLIC_SIGNING_API_URL=https://<PROJE>.vercel.app
//   (Vercel için /api otomatik eklenir -> .../api/uploads/sign)
// - Render/Express (bizim server): https://<servis>.onrender.com (kök: /uploads/*, /health)
// - Firebase Functions örn: https://us-central1-<ID>.cloudfunctions.net/uploadsSign (tam URL de verilebilir)
// - Yerel geliştirme: `tiktok-clone/server` (LAN IP / localhost)
import { Platform } from 'react-native';

const DEV_WEB = 'http://localhost:4000';
// Android emülatör: 10.0.2.2; gerçek cihaz (Expo Go, yerel server): bilgisayar LAN IP'si:
const DEV_NATIVE = 'http://192.168.1.102:4000';

let PUBLIC_URL = String(process.env.EXPO_PUBLIC_SIGNING_API_URL || '').trim().replace(/\/$/, '');
// Tam imza endpoint'i verildiyse (…/uploads/sign veya …/uploadsSign) tabana çevir;
// istemci her zaman `/uploads/sign` ekler.
if (PUBLIC_URL) {
  try {
    const u = new URL(PUBLIC_URL);
    const p = u.pathname.replace(/\/$/, '');
    if (/\/(uploads\/sign|uploadsSign)$/i.test(p)) {
      u.pathname = p.replace(/\/(uploads\/sign|uploadsSign)$/i, '') || '/';
      PUBLIC_URL = u.toString().replace(/\/$/, '');
    } else if (/\.vercel\.app$/i.test(u.hostname)) {
      // Vercel serverless: /api/uploads/sign dosya rotası için /api ekle
      if (!/\/(api)(\/|$)/i.test(p)) u.pathname = (p === '/' ? '' : p) + '/api';
      PUBLIC_URL = u.toString().replace(/\/$/, '');
    } else if (!/cloudfunctions\.net/i.test(u.hostname)) {
      // Render/Express (bizim server): /uploads/* ve /health kökte; yanlış eklenmiş /api'yi kaldır
      if (/\/(api)$/i.test(p)) u.pathname = p.replace(/\/(api)$/i, '') || '/';
      PUBLIC_URL = u.toString().replace(/\/$/, '');
    }
  } catch {}
}

export const API_BASE_URL = PUBLIC_URL || (Platform.OS === 'web' ? DEV_WEB : DEV_NATIVE);
export const IS_PUBLIC_SIGNING_API = !!String(process.env.EXPO_PUBLIC_SIGNING_API_URL || '').trim();
