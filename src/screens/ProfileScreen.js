import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  Alert,
  ActivityIndicator,
  FlatList,
  Dimensions,
  StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { fetchUserVideos, deriveVideoThumbnail, deleteUserVideo } from '../services/videos';
import VideoCard from '../components/VideoCard';

const { height } = Dimensions.get('window');

const formatCount = (value) => {
  if (!value && value !== 0) return '0';
  if (value >= 1000000) return (value / 1000000).toFixed(1) + 'M';
  if (value >= 1000) return (value / 1000).toFixed(1) + 'K';
  return String(value);
};

function mapToFeedVideo(v, user) {
  const username = v.username || user?.username || 'kullanici';
  const mediaType = v.mediaType || (/\.(jpe?g|png|webp|heic|gif)(\?|$)/i.test(v.mediaUrl || v.videoUrl || '') ? 'image' : 'video');
  const mediaUrl = v.mediaUrl || v.videoUrl;
  return {
    ...v,
    mediaType,
    mediaUrl,
    videoUri: mediaUrl,
    thumbnail: v.thumbnailUrl || (mediaType === 'video' ? deriveVideoThumbnail(mediaUrl) : mediaUrl) || mediaUrl,
    caption: v.caption || '',
    user: {
      username: username.startsWith('@') ? username : `@${username}`,
      displayName: v.displayName || user?.displayName || '',
      avatar: v.avatar || user?.avatar || 'https://i.pravatar.cc/150?img=12',
      isVerified: false,
      isFollowing: false,
    },
    stats: {
      likes: v.likesCount ?? 0,
      comments: v.commentsCount ?? 0,
      shares: v.sharesCount ?? 0,
    },
    music: {
      title: `Orijinal ses - ${username}`,
      cover: v.avatar || user?.avatar || 'https://i.pravatar.cc/150?img=12',
    },
  };
}

function GridThumb({ uri, fallback }) {
  const [src, setSrc] = React.useState(uri || fallback || null);
  React.useEffect(() => { setSrc(uri || fallback || null); }, [uri, fallback]);
  if (!src) {
    return (
      <View style={[styles.thumb, styles.thumbEmpty]}>
        <Ionicons name="videocam-outline" size={22} color="#666" />
      </View>
    );
  }
  return (
    <Image
      source={{ uri: src }}
      style={styles.thumb}
      resizeMode="cover"
      onError={() => {
        if (fallback && src !== fallback) setSrc(fallback);
        else setSrc(null);
      }}
    />
  );
}

function VideoFeedViewer({ videos, initialIndex, onClose }) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [h, setH] = useState(height);
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 80 }).current;
  const onViewableItemsChanged = useRef(({ viewableItems }) => {
    if (viewableItems.length > 0) setCurrentIndex(viewableItems[0].index ?? 0);
  }).current;

  const renderItem = useCallback(
    ({ item, index }) => <VideoCard video={item} isActive={index === currentIndex} itemHeight={h} />,
    [currentIndex, h]
  );

  // Sekme içi katman: alt (Liquid Glass) bar görünür kalır.
  return (
    <View style={styles.viewerOverlay} onLayout={(e) => { const nh = e.nativeEvent.layout.height; if (nh > 0) setH(nh); }}>
      <StatusBar barStyle="light-content" />
      <TouchableOpacity style={styles.viewerClose} onPress={onClose}>
        <Ionicons name="chevron-back" size={28} color="#fff" />
      </TouchableOpacity>
      <FlatList
        key={`vf-${Math.round(h)}`}
        data={videos}
        renderItem={renderItem}
        keyExtractor={(item, i) => item.id || String(i)}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        decelerationRate="fast"
        snapToInterval={h}
        snapToAlignment="start"
        initialScrollIndex={initialIndex}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        getItemLayout={(_, index) => ({ length: h, offset: h * index, index })}
        onScrollToIndexFailed={() => {}}
      />
    </View>
  );
}

const ProfileScreen = () => {
  const { user, logout } = useAuth();
  const navigation = useNavigation();
  const [activeTab, setActiveTab] = useState('videos');
  const [myVideos, setMyVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [viewerIndex, setViewerIndex] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const isFocused = useIsFocused();
  useEffect(() => { if (!isFocused) setViewerIndex(null); }, [isFocused]);

  const load = async () => {
    if (!user?.id) {
      setMyVideos([]);
      setLoading(false);
      return;
    }
    setLoadError(null);
    try {
      const items = await fetchUserVideos(user.id);
      setMyVideos(items);
    } catch (e) {
      const code = String(e?.code || '');
      if (code.includes('permission-denied')) {
        setLoadError('Videolar yüklenemedi (izin). Firestore kurallarını kontrol edin.');
      } else if (code.includes('failed-precondition')) {
        setLoadError('Videolar yüklenemedi (sorgu/index). Biraz sonra tekrar deneyin.');
      } else {
        setLoadError('Videolar yüklenemedi.');
      }
      setMyVideos([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [user?.id]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const handleSignOut = () => {
    Alert.alert('Çıkış yap', 'Hesabından çıkmak istiyor musun?', [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Çıkış yap', style: 'destructive', onPress: () => { logout().catch(() => {}); } },
    ]);
  };

  const handleDeleteVideo = (v) => {
    if (!v?.id || deletingId) return;
    Alert.alert('Videoyu sil', 'Bu videoyu silmek istiyor musun? Bu işlem geri alınamaz.', [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Sil',
        style: 'destructive',
        onPress: async () => {
          setDeletingId(v.id);
          try {
            await deleteUserVideo({ videoId: v.id, loopsId: v.loopsId, user });
            setMyVideos((prev) => prev.filter((x) => x.id !== v.id));
            setViewerIndex((idx) => (idx == null ? null : null)); // görüntüleyici açıksa kapat
          } catch (e) {
            Alert.alert('Silinemedi', e?.message || 'Video silinirken bir sorun oluştu.');
          } finally {
            setDeletingId(null);
          }
        },
      },
    ]);
  };

  const thumbUri = (v) => {
    const u = v.mediaUrl || v.videoUrl;
    const isImage = v.mediaType === 'image' || /.(jpe?g|png|webp|heic|gif)(\?|$)/i.test(u || '');
    if (isImage) return v.thumbnailUrl || u || null;
    const derived = u ? deriveVideoThumbnail(u) : null;
    const t = v.thumbnailUrl || '';
    // Hazır jpg poster kullan (mp4/ham video URL'si <Image>'da gri kalır).
    if (t && /f_jpg|so_0|\.(jpg|jpeg|png|webp)(\?|$)/i.test(t) && !/\.(mp4|mov|webm|m4v)(\?|$)/i.test(t)) return t;
    if (derived) return derived;
    if (t && !/\.(mp4|mov|webm|m4v)(\?|$)/i.test(t)) return t;
    return derived || null;
  };

  if (!user) return null;

  const feedVideos = myVideos.map((v) => mapToFeedVideo(v, user));

  return (
    <View style={styles.container}>
      {viewerIndex != null ? (
        <VideoFeedViewer
          videos={feedVideos}
          initialIndex={viewerIndex}
          onClose={() => setViewerIndex(null)}
        />
      ) : null}

      {/* Üst bar */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.headerIcon}>
          <Ionicons name="person-add-outline" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerName} numberOfLines={1}>
          {user.displayName || user.username}
        </Text>
        <TouchableOpacity style={styles.headerIcon} onPress={handleSignOut}>
          <Ionicons name="log-out-outline" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />
        }
      >
        {/* Profil üstü */}
        <View style={styles.profileTop}>
          <Image source={{ uri: user.avatar }} style={styles.avatar} />
          <View style={styles.stats}>
            <View style={styles.stat}>
              <Text style={styles.statNum}>{formatCount(user.stats?.following)}</Text>
              <Text style={styles.statLabel}>Takip</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statNum}>{formatCount(user.stats?.followers)}</Text>
              <Text style={styles.statLabel}>Takipçi</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statNum}>{formatCount(user.stats?.likes)}</Text>
              <Text style={styles.statLabel}>Beğeni</Text>
            </View>
          </View>
        </View>

        <Text style={styles.displayName}>@{user.username}</Text>
        <Text style={styles.bio}>{user.bio || 'Henüz bio eklenmedi.'}</Text>

        <View style={styles.actions}>
          <TouchableOpacity style={styles.editBtn} onPress={() => navigation.navigate('EditProfile')}>
            <Text style={styles.editBtnText}>Profili düzenle</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconBtn}>
            <Ionicons name="bookmark-outline" size={18} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Sekmeler */}
        <View style={styles.tabs}>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'videos' && styles.tabActive]}
            onPress={() => setActiveTab('videos')}
          >
            <Ionicons
              name="grid-outline"
              size={22}
              color={activeTab === 'videos' ? '#fff' : 'rgba(255,255,255,0.45)'}
            />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'private' && styles.tabActive]}
            onPress={() => setActiveTab('private')}
          >
            <Ionicons
              name="lock-closed-outline"
              size={22}
              color={activeTab === 'private' ? '#fff' : 'rgba(255,255,255,0.45)'}
            />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'liked' && styles.tabActive]}
            onPress={() => setActiveTab('liked')}
          >
            <Ionicons
              name="heart-outline"
              size={22}
              color={activeTab === 'liked' ? '#fff' : 'rgba(255,255,255,0.45)'}
            />
          </TouchableOpacity>
        </View>

        {/* Video ızgarası */}
        {activeTab === 'private' ? (
          <View style={styles.emptyState}>
            <Ionicons name="lock-closed-outline" size={40} color="rgba(255,255,255,0.35)" />
            <Text style={styles.emptyTitle}>Gizli videoların</Text>
            <Text style={styles.emptyDesc}>Buradaki videoları yalnızca sen görebilirsin.</Text>
          </View>
        ) : activeTab === 'liked' ? (
          <View style={styles.emptyState}>
            <Ionicons name="heart-outline" size={40} color="rgba(255,255,255,0.35)" />
            <Text style={styles.emptyTitle}>Beğenilen videolar</Text>
            <Text style={styles.emptyDesc}>Beğendiğin videolar burada görünecek.</Text>
          </View>
        ) : loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color="#fff" />
          </View>
        ) : loadError ? (
          <View style={styles.emptyState}>
            <Ionicons name="cloud-offline-outline" size={40} color="rgba(255,255,255,0.35)" />
            <Text style={styles.emptyTitle}>{loadError}</Text>
            <Text style={styles.emptyDesc}>Aşağı çekerek tekrar deneyebilirsin.</Text>
          </View>
        ) : myVideos.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="videocam-outline" size={40} color="rgba(255,255,255,0.35)" />
            <Text style={styles.emptyTitle}>Henüz video yok</Text>
            <Text style={styles.emptyDesc}>Paylaştığın videolar burada görünecek. İlk videonu yüklemek için + sekmesini kullan.</Text>
          </View>
        ) : (
          <View style={styles.grid}>
            {myVideos.map((v, i) => (
              <TouchableOpacity
                key={v.id}
                style={[styles.gridItem, (i % 3 === 2) && { marginRight: 0 }]}
                onPress={() => (v.mediaUrl || v.videoUrl) ? setViewerIndex(i) : Alert.alert('Açılamadı', 'Medya adresi bulunamadı.')}
                onLongPress={() => handleDeleteVideo(v)}
                delayLongPress={350}
              >
                <GridThumb uri={thumbUri(v)} fallback={deriveVideoThumbnail(v.mediaUrl || v.videoUrl)} />
                <View style={styles.thumbOverlay}>
                  <Ionicons name="play-outline" size={14} color="#fff" />
                  <Text style={styles.thumbViews}>{formatCount(v.viewsCount || 0)}</Text>
                </View>
                <TouchableOpacity
                  style={styles.thumbDeleteBtn}
                  onPress={() => handleDeleteVideo(v)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  disabled={deletingId === v.id}
                >
                  <Ionicons name={deletingId === v.id ? 'hourglass-outline' : 'trash-outline'} size={14} color="#fff" />
                </TouchableOpacity>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>
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
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  headerIcon: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerName: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
    flex: 1,
    textAlign: 'center',
  },
  content: {
    paddingBottom: 110,
  },
  profileTop: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginTop: 8,
  },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: '#222',
  },
  stats: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginLeft: 12,
  },
  stat: {
    alignItems: 'center',
  },
  statNum: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  statLabel: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    marginTop: 2,
  },
  displayName: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
    paddingHorizontal: 16,
    marginTop: 12,
  },
  bio: {
    color: '#fff',
    fontSize: 14,
    paddingHorizontal: 16,
    marginTop: 4,
    lineHeight: 19,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginTop: 14,
  },
  editBtn: {
    flex: 1,
    height: 36,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  editBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  tabs: {
    flexDirection: 'row',
    marginTop: 18,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
  },
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: '#fff',
  },
  emptyState: {
    alignItems: 'center',
    paddingTop: 44,
    paddingHorizontal: 28,
  },
  emptyTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginTop: 12,
  },
  emptyDesc: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
  },
  loadingWrap: {
    paddingTop: 44,
    alignItems: 'center',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 2,
  },
  gridItem: {
    width: '33.3333%',
    aspectRatio: 3 / 4,
    paddingRight: 2,
    marginBottom: 2,
  },
  thumb: {
    width: '100%',
    height: '100%',
    backgroundColor: '#1a1a1a',
  },
  thumbOverlay: {
    position: 'absolute',
    left: 6,
    bottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
  },
  thumbViews: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 3,
  },
  viewerOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
    zIndex: 50,
  },
  viewerClose: {
    position: 'absolute',
    top: 48,
    left: 12,
    zIndex: 20,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default ProfileScreen;
