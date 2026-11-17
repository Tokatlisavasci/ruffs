import { TurboModuleRegistry } from 'react-native';

// react-native-google-mobile-ads native binary'de RNGoogleMobileAdsModule arıyor.
// Expo Go'da bu modül yok; paketi import etmek tek başına çökme sebebi.
let availability;
let adsModule = null;

export function isNativeAdsAvailable() {
  if (availability !== undefined) return availability;
  try {
    availability = !!TurboModuleRegistry.get('RNGoogleMobileAdsModule');
  } catch {
    availability = false;
  }
  return availability;
}

export function getAds() {
  if (!isNativeAdsAvailable()) return null;
  if (adsModule) return adsModule;
  try {
    adsModule = require('react-native-google-mobile-ads');
  } catch (e) {
    console.warn('AdMob modülü yüklenemedi:', e?.message || e);
    adsModule = null;
  }
  return adsModule;
}
