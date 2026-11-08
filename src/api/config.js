// Yükleme/proxy API taban URL'si (Render/Express sunucusu).
// .env / .env.local:
//   EXPO_PUBLIC_SIGNING_API_URL=https://<servis>.onrender.com
// Not: Sadece React Native (expo-constants) tarafından okunur; Node/Render bu dosyayı kullanmaz.

import Constants from 'expo-constants';

const extra =
  (Constants.expoConfig && Constants.expoConfig.extra) ||
  (Constants.manifest && Constants.manifest.extra) ||
  {};

const RAW = process.env.EXPO_PUBLIC_SIGNING_API_URL || extra.signingApiUrl || '';

function normalizeBase(url) {
  if (!url || typeof url !== 'string') return '';
  let t = url.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(t)) t = `https://${t}`;
  return t.replace(/\/+$/, '');
}

export const API_BASE_URL = normalizeBase(RAW);
