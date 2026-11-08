import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, StatusBar, Dimensions, ScrollView, Image, ActivityIndicator, FlatList } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { fetchUserProfile, fetchUserVideos, fetchMyFollowingIds, deriveVideoThumbnail, toggleFollow } from '../services/videos';
import VideoCard from '../components/VideoCard';

const { width, height } = Dimensions.get('window');

const formatCount = (n) => {
  if (n == null) return '0';
  const value = Number(n) || 0;
  if (value >= 1000000) return (value / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (value >= 1000) return (value / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(value);
};

function mapToFeedVideo(v, profile) {
  const username = v.username || profile?.username || 'kullanici';
  const mediaType = v.mediaType || (/\.(jpe?g|png|webp|heic|gif)(\?|$)/i.test(v.mediaUrl || v.videoUrl || '') ? 'image' : 'video');
  const mediaUrl = v.mediaUrl || v.videoUrl;
  return {
    ...v,
    mediaType,
    mediaUrl,
    videoUri: mediaUrl,
    thumbnail: v.thumbnailUrl || (mediaType === 'video' ? deriveVideoThumbnail(mediaUrl) : mediaUrl) || mediaUrl,
    caption: v.caption || '',
    uid: v.uid || profile?.id,
    user: {
      uid: v.uid || profile?.id,
      username: username.startsWith('@') ? username : `@${username}`,
      displayName: v.displayName || profile?.displayName || '',
      avatar: v.avatar || profile?.avatar || null,
      isVerified: false,
    },
    stats: {
      likes: v.likesCount ?? 0,
      comments: v.commentsCount ?? 0,
      shares: v.sharesCount ?? 0,
      saves: v.savesCount ?? 0,
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

  return (
    <View style={styles.viewerOverlay} onLayout={(e) => { const nh = e.nativeEvent.layout.height; if (nh > 0) setH(nh); }}>
      <StatusBar barStyle="light-content" />
      <TouchableOpacity style={styles.viewerClose} onPress={onClose}>
        <Ionicons name="chevron-back" size={28} color="#fff" />
      </TouchableOpacity>
      <FlatList
        key={`uv-${Math.round(h)}`}
        data={videos}
        renderItem={renderItem}
        keyExtractor={(item, i) => item.id || String(i)}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        decelerationRate="fast"
        snapToInterval={h}
        snapToAlignment="start"
        disableIntervalMomentum
        initialScrollIndex={Math.max(0, initialIndex)}
        getItemLayout={(_, index) => ({ length: h, offset: h * index, index })}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        windowSize={3}
        initialNumToRender={2}
        maxToRenderPerBatch={2}
        removeClippedSubviews
        onScrollToIndexFailed={() => {}}
      />
    </View>
  );
}

export default function UserProfileScreen({ route, navigation }) {
  const { userId } = route.params || {};
  const { user: me, refreshUser } = useAuth();
  const [profile, setProfile] = useState(null);
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [following, setFollowing] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(null);

  const load = useCallback(async () => {
    if (!userId) { setLoading(false); return; }
    setLoading(true);
    try {
      const [p, vids, fIds] = await Promise.all([
        fetchUserProfile(userId),
        fetchUserVideos(userId),
        me?.id ? fetchMyFollowingIds(me.id) : Promise.resolve(new Set()),
      ]);
      setProfile(p);
      setVideos(vids || []);
      setFollowing(!!fIds?.has?.(userId));
    } catch {}
    finally { setLoading(false); }
  }, [userId, me?.id]);

  useEffect(() => { load(); }, [load]);

  const isMe = me?.id && me.id === userId;

  const handleFollow = async () => {
    if (!userId || isMe || followBusy) return;
    const prev = following;
    setFollowing(!prev);
    setFollowBusy(true);
    try {
      const res = await toggleFollow(userId);
      setFollowing(res.following);
      setProfile((p) => (p ? { ...p, followers: typeof res.theirFollowers === 'number' ? res.theirFollowers : p.followers } : p));
      refreshUser?.();
    } catch {
      setFollowing(prev);
    } finally {
      setFollowBusy(false);
    }
  };

  const thumbUri = (v) => v.thumbnailUrl || (v.mediaType === 'image' ? (v.mediaUrl || v.videoUrl) : deriveVideoThumbnail(v.mediaUrl || v.videoUrl)) || v.mediaUrl || v.videoUrl || null;
  const feedVideos = videos.map((v) => mapToFeedVideo(v, profile || { id: userId }));
  const displayHandle = profile?.username ? `@${String(profile.username).replace(/^@/, '')}` : '';

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      <View style={styles.header}>
        <TouchableOpacity style={styles.headerIcon} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={26} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerName} numberOfLines={1}>{displayHandle}</Text>
        <View style={styles.headerIcon} />
      </View>

      {loading ? (
        <View style={styles.loadingWrap}><ActivityIndicator color="#fff" /></View>
      ) : !profile ? (
        <View style={styles.loadingWrap}><Text style={styles.emptyDesc}>Profil bulunamadı.</Text></View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.profileTop}>
            {profile.avatar ? (
              <Image source={{ uri: profile.avatar }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, { backgroundColor: '#fff' }]} />
            )}
            <View style={styles.stats}>
              <View style={styles.stat}>
                <Text style={styles.statNum}>{formatCount(profile.following ?? 0)}</Text>
                <Text style={styles.statLabel}>Takip</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statNum}>{formatCount(profile.followers ?? 0)}</Text>
                <Text style={styles.statLabel}>Takipçi</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statNum}>{formatCount(profile.likes ?? 0)}</Text>
                <Text style={styles.statLabel}>Beğeni</Text>
              </View>
            </View>
          </View>

          <Text style={styles.displayName}>{profile.displayName || profile.username || 'Kullanıcı'}</Text>
          {profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}

          {!isMe ? (
            <View style={styles.actions}>
              <TouchableOpacity style={[styles.followBtn, following && styles.followBtnOn]} onPress={handleFollow} disabled={followBusy}>
                <Text style={styles.followBtnText}>{following ? 'Takiptesin' : 'Takip Et'}</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          <View style={styles.tabs}>
            <View style={[styles.tab, styles.tabActive]}>
              <Ionicons name="grid" size={22} color="#fff" />
            </View>
          </View>

          {videos.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="videocam-off-outline" size={36} color="rgba(255,255,255,0.35)" />
              <Text style={styles.emptyDesc}>Henüz video yok.</Text>
            </View>
          ) : (
            <View style={styles.grid}>
              {videos.map((v, i) => (
                <TouchableOpacity key={v.id} style={styles.gridItem} onPress={() => (v.mediaUrl || v.videoUrl) ? setViewerIndex(i) : null}>
                  <GridThumb uri={thumbUri(v)} fallback={deriveVideoThumbnail(v.mediaUrl || v.videoUrl)} />
                  <View style={styles.thumbOverlay}>
                    <Ionicons name="play-outline" size={14} color="#fff" />
                    <Text style={styles.thumbViews}>{formatCount(v.viewsCount || 0)}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </ScrollView>
      )}

      {viewerIndex != null ? (
        <VideoFeedViewer videos={feedVideos} initialIndex={viewerIndex} onClose={() => setViewerIndex(null)} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', paddingTop: 48 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 8 },
  headerIcon: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  headerName: { color: '#fff', fontSize: 17, fontWeight: '700', flex: 1, textAlign: 'center' },
  content: { paddingBottom: 110 },
  profileTop: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginTop: 8 },
  avatar: { width: 88, height: 88, borderRadius: 44, backgroundColor: '#222' },
  stats: { flex: 1, flexDirection: 'row', justifyContent: 'space-around', marginLeft: 12 },
  stat: { alignItems: 'center' },
  statNum: { color: '#fff', fontSize: 17, fontWeight: '700' },
  statLabel: { color: 'rgba(255,255,255,0.6)', fontSize: 12, marginTop: 2 },
  displayName: { color: '#fff', fontSize: 15, fontWeight: '600', paddingHorizontal: 16, marginTop: 12 },
  bio: { color: '#fff', fontSize: 14, paddingHorizontal: 16, marginTop: 4, lineHeight: 19 },
  actions: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginTop: 14 },
  followBtn: { flex: 1, height: 36, borderRadius: 8, backgroundColor: '#FE2C55', alignItems: 'center', justifyContent: 'center' },
  followBtnOn: { backgroundColor: 'rgba(255,255,255,0.12)' },
  followBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  tabs: { flexDirection: 'row', marginTop: 18, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)' },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 10 },
  tabActive: { borderBottomWidth: 2, borderBottomColor: '#fff' },
  emptyState: { alignItems: 'center', paddingTop: 44, paddingHorizontal: 28 },
  emptyDesc: { color: 'rgba(255,255,255,0.55)', fontSize: 13, textAlign: 'center', marginTop: 6, lineHeight: 18 },
  loadingWrap: { paddingTop: 44, alignItems: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 2 },
  gridItem: { width: '33.3333%', aspectRatio: 3 / 4, paddingRight: 2, marginBottom: 2 },
  thumb: { width: '100%', height: '100%', backgroundColor: '#1a1a1a' },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#1a1a1a' },
  thumbOverlay: { position: 'absolute', left: 6, bottom: 6, flexDirection: 'row', alignItems: 'center' },
  thumbViews: { color: '#fff', fontSize: 12, fontWeight: '600', marginLeft: 3 },
  viewerOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000', zIndex: 50 },
  viewerClose: { position: 'absolute', top: 48, left: 12, zIndex: 20, width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
});
