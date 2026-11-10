import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import mobileAds from 'react-native-google-mobile-ads';
import { AuthProvider } from './src/context/AuthContext';
import TikTokCloneApp from './src/navigation/Navigation';

export default function App() {
  useEffect(() => {
    mobileAds()
      .initialize()
      .catch(() => {});
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <StatusBar style="light" />
        <TikTokCloneApp />
      </AuthProvider>
    </GestureHandlerRootView>
  );
}
