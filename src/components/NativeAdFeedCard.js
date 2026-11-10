import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Dimensions, ActivityIndicator } from 'react-native';
import {
  NativeAd,
  NativeAdView,
  NativeAsset,
  NativeAssetType,
  NativeMediaView,
  TestIds,
} from 'react-native-google-mobile-ads';

const { width, height } = Dimensions.get('window');

// Android Native ad unit (AdMob). Replace with TestIds.NATIVE during development if needed.
export const FEED_NATIVE_AD_UNIT_ID = 'ca-app-pub-5438786046362290/8886762349';

const NativeAdFeedCard = ({ isActive }) => {
  const [nativeAd, setNativeAd] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let mounted = true;
    let ad;
    NativeAd.createForAdRequest(FEED_NATIVE_AD_UNIT_ID, { requestNonPersonalizedAdsOnly: false })
      .then((loaded) => {
        ad = loaded;
        if (mounted) setNativeAd(loaded);
        else loaded.destroy();
      })
      .catch((e) => {
        if (mounted) setError(e);
      });
    return () => {
      mounted = false;
      try { ad?.destroy?.(); } catch {}
    };
  }, []);

  if (error) {
    return (
      <View style={styles.container}>
        <View style={styles.fallback}>
          <Text style={styles.fallbackText}>Reklam yüklenemedi</Text>
        </View>
      </View>
    );
  }

  if (!nativeAd) {
    return (
      <View style={styles.container}>
        <View style={styles.fallback}>
          <ActivityIndicator color="#fff" />
          <Text style={styles.loadingText}>Reklam</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <NativeAdView nativeAd={nativeAd} style={styles.adView}>
        <View style={styles.mediaWrap}>
          <NativeMediaView style={styles.media} resizeMode="cover" />
        </View>

        <View style={styles.badgeRow}>
          <View style={styles.adBadge}><Text style={styles.adBadgeText}>Reklam</Text></View>
        </View>

        <View style={styles.bottom}>
          <View style={styles.textCol}>
            <NativeAsset assetType={NativeAssetType.HEADLINE}>
              <Text style={styles.headline} numberOfLines={2} />
            </NativeAsset>
            <NativeAsset assetType={NativeAssetType.ADVERTISER}>
              <Text style={styles.advertiser} numberOfLines={1} />
            </NativeAsset>
            <NativeAsset assetType={NativeAssetType.BODY}>
              <Text style={styles.body} numberOfLines={2} />
            </NativeAsset>
          </View>
          <NativeAsset assetType={NativeAssetType.CALL_TO_ACTION}>
            <View style={styles.cta}>
              <Text style={styles.ctaText}>Aç</Text>
            </View>
          </NativeAsset>
        </View>
      </NativeAdView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { width, height, backgroundColor: '#000' },
  adView: { flex: 1, width: '100%', height: '100%' },
  mediaWrap: { ...StyleSheet.absoluteFillObject },
  media: { width: '100%', height: '100%' },
  fallback: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#111' },
  fallbackText: { color: 'rgba(255,255,255,0.6)', fontSize: 14 },
  loadingText: { color: 'rgba(255,255,255,0.6)', marginTop: 8, fontSize: 13 },
  badgeRow: { position: 'absolute', top: 100, left: 12 },
  adBadge: { backgroundColor: '#F5C518', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  adBadgeText: { color: '#000', fontSize: 11, fontWeight: '700' },
  bottom: {
    position: 'absolute', left: 12, right: 12, bottom: 110,
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
  },
  textCol: { flex: 1, paddingRight: 12 },
  headline: { color: '#fff', fontSize: 16, fontWeight: '700' },
  advertiser: { color: 'rgba(255,255,255,0.85)', fontSize: 13, marginTop: 2 },
  body: { color: 'rgba(255,255,255,0.8)', fontSize: 13, marginTop: 4 },
  cta: { backgroundColor: '#FE2C55', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8 },
  ctaText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});

export default NativeAdFeedCard;
