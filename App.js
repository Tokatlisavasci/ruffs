import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { getAds } from './src/config/ads';
import { AuthProvider } from './src/context/AuthContext';
import TikTokCloneApp from './src/navigation/Navigation';

export default function App() {
  useEffect(() => {
    // Expo Go'da AdMob native modülü yok; bu durumda hiç yüklenmez.
    const ads = getAds();
    if (!ads?.default) return;
    try {
      ads.default()
        .initialize()
        .catch(() => {});
    } catch {}
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <StatusBar style="light" />
          <TikTokCloneApp />
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
