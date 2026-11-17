import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  TouchableOpacity,
  Dimensions,
  StatusBar,
  ActivityIndicator,
  RefreshControl,
  Modal,
  Linking,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { fetchTrendingVideos } from '../services/videos';

const { width } = Dimensions.get('window');
const GAP = 2;
const COL = (width - GAP) / 2;
const AUTO_REFRESH_MS = 10 * 60 * 1000;

const formatCount = (value) => {
  const n = Number(value) || 0;
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
};

const formatDuration = (seconds) => {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
};

const TrendPlayerModal = ({ item, onClose }) => {
  // TikTok CDN'i doğrudan oynatmaya izin vermiyor; Referer şart.
  const source = useMemo(
    () => (item?.playUrl ? { uri: item.playUrl, headers: { Referer: 'https://www.tiktok.com/' } } : null),
    [item?.playUrl]
  );
  const player = useVideoPlayer(source, (p) => {
    p.loop = true;
  });

  const togglePlay = () => {
    try {
      if (player.playing) player.pause();
      else player.play();
    } catch {}
  };

  useEffect(() => {
    if (!item?.playUrl) return;
    try {
      player.play();
    } catch {}
    return () => {
      try {
        player.pause();
      } catch {}
    };
  }, [player, item?.playUrl]);

  const openOnTikTok = () => {
    if (item?.webUrl) Linking.openURL(item.webUrl).catch(() => {});
  };

  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.playerRoot}>
        <StatusBar barStyle="light-content" />
        {item?.playUrl ? (
          <Pressable style={styles.playerVideo} onPress={togglePlay}>
            <VideoView player={player} style={styles.playerVideo} contentFit="contain" nativeControls={false} />
          </Pressable>
        ) : (
          <View style={styles.playerFallback}>
            <Ionicons name="videocam-off-outline" size={42} color="rgba(255,255,255,0.4)" />
            <Text style={styles.playerFallbackText}>Bu video oynatılamıyor</Text>
          </View>
        )}

        <TouchableOpacity style={styles.closeBtn} onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="close" size={26} color="#fff" />
        </TouchableOpacity>

        <View style={styles.playerInfo}>
          <Text style={styles.playerAuthor}>
            @{item?.author?.uniqueId || 'tiktok'}
            {item?.author?.verified ? '  ✓' : ''}
          </Text>
          {item?.desc ? (
            <Text style={styles.playerDesc} numberOfLines={3}>
              {item.desc}
            </Text>
          ) : null}
          <View style={styles.playerStats}>
            <Ionicons name="play" size={13} color="#fff" />
            <Text style={styles.playerStatText}>{formatCount(item?.stats?.views)}</Text>
            <Ionicons name="heart" size={13} color="#fff" style={{ marginLeft: 12 }} />
            <Text style={styles.playerStatText}>{formatCount(item?.stats?.likes)}</Text>
            <Ionicons name="chatbubble-ellipses" size={13} color="#fff" style={{ marginLeft: 12 }} />
            <Text style={styles.playerStatText}>{formatCount(item?.stats?.comments)}</Text>
          </View>
          {item?.webUrl ? (
            <Pressable style={styles.tiktokBtn} onPress={openOnTikTok}>
              <Ionicons name="logo-tiktok" size={16} color="#000" />
              <Text style={styles.tiktokBtnText}>TikTok'ta aç</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Modal>
  );
};

const DiscoverScreen = () => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const lastLoadedAt = useRef(0);

  const load = useCallback(async ({ refresh = false, silent = false } = {}) => {
    if (!silent) setError(null);
    try {
      const res = await fetchTrendingVideos({ count: 24, refresh });
      setItems(res.videos || []);
      lastLoadedAt.current = Date.now();
      if (!res.videos?.length) setError('TikTok trend videoları boş döndü.');
    } catch (e) {
      setError(e?.message || 'Trendler alınamadı.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Ekrana her dönüşte otomatik tazele (sunucu 10 dk önbellekliyor).
  useFocusEffect(
    useCallback(() => {
      if (Date.now() - lastLoadedAt.current > AUTO_REFRESH_MS) {
        load({ silent: true });
      }
    }, [load])
  );

  const onRefresh = () => {
    setRefreshing(true);
    load({ refresh: true });
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      <View style={styles.header}>
        <View style={styles.headerTitleWrap}>
          <Ionicons name="logo-tiktok" size={18} color="#fff" />
          <Text style={styles.headerTitle}>TikTok Trendleri</Text>
        </View>
        <TouchableOpacity onPress={onRefresh} disabled={refreshing || loading} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          {refreshing ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Ionicons name="refresh" size={20} color="rgba(255,255,255,0.8)" />
          )}
        </TouchableOpacity>
      </View>
      <Text style={styles.headerSub}>Otomatik olarak güncellenir · kaynak: TikTok</Text>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#fff" />
          <Text style={styles.centerText}>Trendler yükleniyor…</Text>
        </View>
      ) : error && items.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={40} color="rgba(255,255,255,0.35)" />
          <Text style={styles.centerText}>{error}</Text>
          <TouchableOpacity style={styles.retry} onPress={() => { setLoading(true); load({ refresh: true }); }}>
            <Text style={styles.retryText}>Tekrar dene</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.gridWrap}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />}
        >
          <View style={styles.grid}>
            {items.map((v, i) => (
              <TouchableOpacity
                key={v.id || String(i)}
                style={[styles.card, i % 2 === 1 && { marginRight: 0 }]}
                activeOpacity={0.85}
                onPress={() => setSelected(v)}
              >
                {v.cover ? (
                  <Image source={{ uri: v.cover }} style={styles.cardImg} resizeMode="cover" />
                ) : (
                  <View style={[styles.cardImg, styles.cardPlaceholder]} />
                )}
                <View style={styles.cardOverlay}>
                  <Ionicons name="play-outline" size={14} color="#fff" />
                  <Text style={styles.cardViews}>{formatCount(v?.stats?.views)}</Text>
                </View>
                {v.duration ? <Text style={styles.cardDuration}>{formatDuration(v.duration)}</Text> : null}
                <Text style={styles.cardAuthor} numberOfLines={1}>
                  @{v?.author?.uniqueId || 'tiktok'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      )}

      {selected ? <TrendPlayerModal item={selected} onClose={() => setSelected(null)} /> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    paddingTop: 48,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
  },
  headerTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    marginLeft: 8,
  },
  headerSub: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 12,
    paddingHorizontal: 14,
    marginTop: 4,
    marginBottom: 12,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingBottom: 80,
  },
  centerText: {
    color: '#fff',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 12,
    lineHeight: 20,
  },
  retry: {
    marginTop: 14,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  retryText: { color: '#fff', fontWeight: '600' },
  gridWrap: {
    paddingBottom: 110,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  card: {
    width: COL,
    height: COL * 1.35,
    marginRight: GAP,
    marginBottom: GAP,
    backgroundColor: '#111',
    overflow: 'hidden',
  },
  cardImg: {
    width: '100%',
    height: '100%',
  },
  cardPlaceholder: {
    backgroundColor: '#1a1a1a',
  },
  cardOverlay: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardViews: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 4,
  },
  cardDuration: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  cardAuthor: {
    position: 'absolute',
    left: 8,
    top: 8,
    right: 8,
    color: 'rgba(255,255,255,0.9)',
    fontSize: 11,
    fontWeight: '600',
  },
  playerRoot: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
  },
  playerVideo: {
    flex: 1,
    width: '100%',
  },
  playerFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playerFallbackText: {
    color: 'rgba(255,255,255,0.6)',
    marginTop: 10,
    fontSize: 14,
  },
  closeBtn: {
    position: 'absolute',
    top: 44,
    right: 16,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playerInfo: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 34,
  },
  playerAuthor: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  playerDesc: {
    color: '#fff',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 6,
  },
  playerStats: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
  },
  playerStatText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 4,
  },
  tiktokBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#fff',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 14,
  },
  tiktokBtnText: {
    color: '#000',
    fontSize: 13,
    fontWeight: '700',
    marginLeft: 6,
  },
});

export default DiscoverScreen;
