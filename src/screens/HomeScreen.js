import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Dimensions,
  StatusBar,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  AppState,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import VideoCard from '../components/VideoCard';
import NativeAdFeedCard from '../components/NativeAdFeedCard';
import { isNativeAdsAvailable } from '../config/ads';
import FeedErrorBoundary from '../components/FeedErrorBoundary';
import { fetchFeedPage, fetchOwnVideos, fetchMyLikedIds, fetchMySavedIds, fetchMyFollowingIds } from '../services/videos';

const { height } = Dimensions.get('window');

const HomeScreen = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const { user } = useAuth();
  const [likedIds, setLikedIds] = useState(new Set());
  const [savedIds, setSavedIds] = useState(new Set());
  const [followingIds, setFollowingIds] = useState(new Set());
  const [activeTab, setActiveTab] = useState('foryou');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [feed, setFeed] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [loadingTrending, setLoadingTrending] = useState(false);
  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 80,
    minimumViewTime: 120,
  }).current;
  const listRef = useRef(null);
  const appState = useRef(AppState.currentState);
  const lastRefreshAt = useRef(0);
  // Sonsuz akış durumu
  const cursorRef = useRef(0);
  const rawFeedRef = useRef([]);
  const loadingMoreRef = useRef(false);
  const moreErrorsRef = useRef(0);
  const loadTokenRef = useRef(0);

  const decorate = (items, ids, sids, fids) =>
    (items || []).map((v) => ({
      ...v,
      isLiked: ids?.has?.(v.id),
      isBookmarked: sids?.has?.(v.id),
      isFollowing: fids?.has?.(v.uid || v.userId),
    }));

  const load = async ({ scrollTop = false } = {}) => {
    const token = loadTokenRef.current + 1;
    loadTokenRef.current = token;
    setError(null);
    try {
      // Önce kendi videolar: bunlar anında gelir, trendler arka planda eklenir.
      const [own, ids, sids, fids] = await Promise.all([
        fetchOwnVideos(),
        user?.id ? fetchMyLikedIds(user.id) : Promise.resolve(new Set()),
        user?.id ? fetchMySavedIds(user.id) : Promise.resolve(new Set()),
        user?.id ? fetchMyFollowingIds(user.id) : Promise.resolve(new Set()),
      ]);
      if (token !== loadTokenRef.current) return;
      setLikedIds(ids || new Set());
      setSavedIds(sids || new Set());
      setFollowingIds(fids || new Set());
      cursorRef.current = 0;
      moreErrorsRef.current = 0;
      rawFeedRef.current = decorate(own, ids, sids, fids);
      setFeed(insertAds(rawFeedRef.current));
      if (scrollTop) {
        setCurrentIndex(0);
        try { listRef.current?.scrollToOffset?.({ offset: 0, animated: false }); } catch {}
      }

      // Trendler yavaş gelebilir (sunucu Chromium açıyor); akışı bloklamadan ekle.
      setLoadingTrending(true);
      fetchFeedPage({ cursor: 0, count: 12, includeOwn: false, timeoutMs: 60000 })
        .then((page) => {
          if (token !== loadTokenRef.current) return;
          cursorRef.current = page?.nextCursor || 0;
          const fresh = decorate(page?.items, ids, sids, fids);
          if (fresh.length) {
            rawFeedRef.current = [...rawFeedRef.current, ...fresh];
            setFeed(insertAds(rawFeedRef.current));
          }
        })
        .catch(() => {})
        .finally(() => {
          if (token === loadTokenRef.current) setLoadingTrending(false);
        });
    } catch (e) {
      const code = String(e?.code || '');
      if (code.includes('permission-denied')) setError('Videolar yüklenemedi (izin). Firestore "videos" kurallarını kontrol edin.');
      else setError('Videolar yüklenemedi.');
      setFeed([]);
      rawFeedRef.current = [];
      setLoadingTrending(false);
    } finally {
      setLoading(false);
    }
  };

  // Akışın sonuna yaklaşınca bir sonraki sayfa eklenir; sunucu havuzu tükendiğinde başa döner.
  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || moreErrorsRef.current >= 3) return;
    loadingMoreRef.current = true;
    try {
      const page = await fetchFeedPage({ cursor: cursorRef.current, count: 8 });
      cursorRef.current = page?.nextCursor || cursorRef.current;
      const fresh = decorate(page?.items, likedIds, savedIds, followingIds);
      if (fresh.length) {
        rawFeedRef.current = [...rawFeedRef.current, ...fresh];
        setFeed(insertAds(rawFeedRef.current));
        moreErrorsRef.current = 0;
      } else {
        moreErrorsRef.current += 1;
      }
    } catch {
      moreErrorsRef.current += 1;
    } finally {
      loadingMoreRef.current = false;
    }
  }, [likedIds, savedIds, followingIds]);

  useEffect(() => { load(); }, [user?.id]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (appState.current.match(/inactive|background/) && next === 'active') {
        load();
      }
      appState.current = next;
    });
    return () => sub?.remove?.();
  }, [user?.id]);

  useEffect(() => {
    const ra = route?.params?.refreshAt;
    if (ra && ra !== lastRefreshAt.current) {
      lastRefreshAt.current = ra;
      setRefreshing(true);
      load({ scrollTop: true }).finally(() => setRefreshing(false));
    }
  }, [route?.params?.refreshAt, user?.id]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load({ scrollTop: true });
    setRefreshing(false);
  };

  const handleLikeChanged = ({ videoId, liked, likesCount }) => {
    setLikedIds((prev) => { const n = new Set(prev); liked ? n.add(videoId) : n.delete(videoId); return n; });
    setFeed((prev) => prev.map((v) => (v.id === videoId ? { ...v, isLiked: liked, likesCount, stats: { ...(v.stats||{}), likes: likesCount } } : v)));
  };

  const handleSaveChanged = ({ videoId, saved, savesCount }) => {
    setSavedIds((prev) => { const n = new Set(prev); saved ? n.add(videoId) : n.delete(videoId); return n; });
    setFeed((prev) => prev.map((v) => (v.id === videoId ? { ...v, isBookmarked: saved, ...(typeof savesCount === 'number' ? { savesCount, stats: { ...(v.stats||{}), saves: savesCount } } : {}) } : v)));
  };

  const handleFollowChanged = ({ targetUid, following }) => {
    setFollowingIds((prev) => { const n = new Set(prev); following ? n.add(targetUid) : n.delete(targetUid); return n; });
    setFeed((prev) => prev.map((v) => ((v.uid || v.userId) === targetUid ? { ...v, isFollowing: following } : v)));
  };

  const onViewableItemsChanged = useRef(({ viewableItems }) => {
    const visible = (viewableItems || []).filter((v) => v.isViewable);
    if (visible.length === 0) return;
    // Prefer the item closest to the middle of the visible set to avoid rapid flips
    const pick = visible.length === 1 ? visible[0] : visible[Math.floor(visible.length / 2)];
    const idx = pick?.index;
    if (typeof idx === 'number') {
      setCurrentIndex((prev) => (prev === idx ? prev : idx));
    }
  }).current;

  const insertAds = (items) => {
    // Expo Go'da AdMob native modülü yok; reklam yuvası da eklenmez.
    if (!isNativeAdsAvailable()) return items || [];
    const out = [];
    const every = 4; // her 4 videodan sonra 1 reklam
    (items || []).forEach((v, i) => {
      out.push(v);
      if ((i + 1) % every === 0) {
        out.push({ __ad: true, id: `ad-${i + 1}` });
      }
    });
    return out;
  };

  const renderItem = useCallback(
    ({ item, index }) => {
      if (item?.__ad) {
        return (
          <FeedErrorBoundary>
            <NativeAdFeedCard isActive={index === currentIndex} />
          </FeedErrorBoundary>
        );
      }
      return <VideoCard video={item} isActive={index === currentIndex} onLikeChanged={handleLikeChanged} onSaveChanged={handleSaveChanged} onFollowChanged={handleFollowChanged} />;
    },
    [currentIndex]
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      {/* Üst sekmeler */}
      <View style={styles.topTabs}>
        <TouchableOpacity onPress={() => setActiveTab('following')}>
          <Text style={[styles.topTab, activeTab === 'following' && styles.topTabActive]}>
            Takip Edilen
          </Text>
        </TouchableOpacity>
        <View style={styles.tabDivider} />
        <TouchableOpacity onPress={() => setActiveTab('foryou')}>
          <Text style={[styles.topTab, activeTab === 'foryou' && styles.topTabActive]}>
            Sana Özel
          </Text>
        </TouchableOpacity>
      </View>

      {/* Arama */}
      <TouchableOpacity style={styles.searchButton} onPress={() => navigation.navigate('Arama')}>
        <Ionicons name="search" size={24} color="#fff" />
      </TouchableOpacity>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#fff" />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={40} color="rgba(255,255,255,0.35)" />
          <Text style={styles.msg}>{error}</Text>
          <TouchableOpacity onPress={() => load()} style={styles.retry}><Text style={styles.retryText}>Tekrar dene</Text></TouchableOpacity>
        </View>
      ) : feed.length === 0 && loadingTrending ? (
        <View style={styles.center}>
          <ActivityIndicator color="#fff" />
          <Text style={styles.sub}>Videolar hazırlanıyor…</Text>
        </View>
      ) : feed.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="videocam-outline" size={40} color="rgba(255,255,255,0.35)" />
          <Text style={styles.msg}>Henüz video yok.</Text>
          <Text style={styles.sub}>İlk videoyu yükleyen sen ol (+).</Text>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={feed}
          renderItem={renderItem}
          keyExtractor={(item, i) => `${item?.id || 'item'}-${i}`}
          pagingEnabled
          showsVerticalScrollIndicator={false}
          decelerationRate="fast"
          snapToInterval={height}
          snapToAlignment="start"
          disableIntervalMomentum
          windowSize={3}
          initialNumToRender={1}
          maxToRenderPerBatch={2}
          removeClippedSubviews
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          getItemLayout={(_, index) => ({ length: height, offset: height * index, index })}
          onEndReached={loadMore}
          onEndReachedThreshold={2.5}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  topTabs: {
    position: 'absolute',
    top: 50,
    left: 0,
    right: 0,
    zIndex: 10,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  topTab: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 17,
    fontWeight: '600',
    paddingHorizontal: 12,
  },
  topTabActive: {
    color: '#fff',
    fontSize: 18,
  },
  tabDivider: {
    width: 1,
    height: 14,
    backgroundColor: 'rgba(255,255,255,0.4)',
  },
  searchButton: {
    position: 'absolute',
    top: 48,
    right: 16,
    zIndex: 10,
    padding: 4,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  msg: {
    color: '#fff',
    fontSize: 15,
    textAlign: 'center',
    marginTop: 12,
  },
  sub: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 6,
  },
  retry: {
    marginTop: 14,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  retryText: { color: '#fff', fontWeight: '600' },
});

export default HomeScreen;
