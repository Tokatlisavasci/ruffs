import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useVideoPlayer, VideoView } from 'expo-video';
import { deriveVideoThumbnail, deriveVideoPlaybackUrl, inferMediaType, toggleVideoLike, recordVideoView, toggleVideoSave } from '../services/videos';

const { width, height } = Dimensions.get('window');

const formatCount = (value) => {
  if (value == null || value === '') return '0';
  if (typeof value === 'string') return value;
  if (value >= 1000000) return (value / 1000000).toFixed(1) + 'M';
  if (value >= 1000) return (value / 1000).toFixed(1) + 'K';
  return String(value);
};

const normalize = (video) => {
  const mediaType = video?.mediaType || inferMediaType({ uri: video?.mediaUrl || video?.videoUri || video?.videoUrl });
  const rawSource = video?.videoUri || video?.mediaUrl || video?.videoUrl || null;
  const source = mediaType === 'video' ? (deriveVideoPlaybackUrl(rawSource) || rawSource) : rawSource;
  const thumb = video?.thumbnail || video?.thumbnailUrl || (mediaType === 'video' && rawSource ? deriveVideoThumbnail(rawSource) : rawSource);
  const user = video?.user || {
    username: video?.username ? `@${String(video.username).replace(/^@/, '')}` : '@kullanici',
    displayName: video?.displayName || '',
    avatar: video?.avatar || null,
    isVerified: false,
    isFollowing: false,
  };
  const stats = video?.stats || {
    likes: video?.likesCount ?? 0,
    comments: video?.commentsCount ?? 0,
    shares: video?.sharesCount ?? 0,
  };
  const music = video?.music || {
    title: `Orijinal ses - ${String(user.username || '').replace(/^@/, '') || 'ruffs'}`,
    cover: user.avatar || null,
  };
  return { mediaType, source, thumb, user, stats, music, caption: video?.caption || '' };
};

const VideoCard = ({ video, isActive, itemHeight = height, itemWidth = width, onDelete, deleting, onLikeChanged, onSaveChanged }) => {
  const n = useMemo(() => normalize(video), [video]);
  const isFocused = useIsFocused();
  const [liked, setLiked] = useState(!!video?.isLiked);
  const [likesCount, setLikesCount] = useState(typeof (video?.likesCount ?? video?.stats?.likes) === 'number' ? (video?.likesCount ?? video?.stats?.likes) : 0);
  const [liking, setLiking] = useState(false);
  const [viewsCount, setViewsCount] = useState(typeof (video?.viewsCount ?? video?.stats?.views) === 'number' ? (video?.viewsCount ?? video?.stats?.views) : 0);
  const viewedRef = useRef(false);
  const [saved, setSaved] = useState(!!video?.isBookmarked);
  const [saving, setSaving] = useState(false);
  const [following, setFollowing] = useState(!!n.user?.isFollowing);

  useEffect(() => { setLiked(!!video?.isLiked); }, [video?.id, video?.isLiked]);
  useEffect(() => { setSaved(!!video?.isBookmarked); }, [video?.id, video?.isBookmarked]);
  useEffect(() => {
    const lc = video?.likesCount ?? video?.stats?.likes;
    if (typeof lc === 'number') setLikesCount(lc);
  }, [video?.id, video?.likesCount, video?.stats?.likes]);
  useEffect(() => { viewedRef.current = false; }, [video?.id]);
  useEffect(() => {
    const vc = video?.viewsCount ?? video?.stats?.views;
    if (typeof vc === 'number') setViewsCount(vc);
  }, [video?.id, video?.viewsCount, video?.stats?.views]);
  useEffect(() => {
    if (!isActive || !isFocused || !video?.id || viewedRef.current) return;
    viewedRef.current = true;
    (async () => {
      const res = await recordVideoView(video.id);
      if (res && typeof res.viewsCount === 'number') setViewsCount(res.viewsCount);
    })();
  }, [isActive, isFocused, video?.id]);

  const handleLike = async () => {
    if (liking || !video?.id) return;
    const prevLiked = liked;
    const prevCount = likesCount;
    const nextLiked = !prevLiked;
    setLiked(nextLiked);
    setLikesCount(Math.max(0, prevCount + (nextLiked ? 1 : -1)));
    setLiking(true);
    try {
      const res = await toggleVideoLike(video.id);
      setLiked(res.liked);
      setLikesCount(res.likesCount);
      onLikeChanged?.({ videoId: video.id, liked: res.liked, likesCount: res.likesCount });
    } catch (e) {
      setLiked(prevLiked);
      setLikesCount(prevCount);
    } finally {
      setLiking(false);
    }
  };

  const handleSave = async () => {
    if (saving || !video?.id) return;
    const prev = saved;
    const next = !prev;
    setSaved(next);
    setSaving(true);
    try {
      const res = await toggleVideoSave(video.id);
      setSaved(res.saved);
      onSaveChanged?.({ videoId: video.id, saved: res.saved });
    } catch (e) {
      setSaved(prev);
    } finally {
      setSaving(false);
    }
  };

  const player = useVideoPlayer(n.mediaType === 'video' ? n.source : null, (p) => {
    p.loop = true;
  });

  useEffect(() => {
    if (n.mediaType !== 'video' || !n.source) return;
    try {
      if (isActive && isFocused) player.play();
      else player.pause();
    } catch {}
  }, [isActive, isFocused, n.source, n.mediaType, player]);

  return (
    <View style={[styles.container, { width: itemWidth, height: itemHeight }]}>
      {n.mediaType === 'video' && n.source ? (
        <VideoView
          player={player}
          style={styles.background}
          contentFit="cover"
          nativeControls={false}
        />
      ) : n.source || n.thumb ? (
        <Image source={{ uri: n.thumb || n.source }} style={styles.background} resizeMode="cover" />
      ) : (
        <View style={[styles.background, { backgroundColor: '#111' }]} />
      )}

      {/* Sağ aksiyon sütunu */}
      <View style={styles.actions}>
        <View style={styles.avatarWrap}>
          {n.user.avatar ? (
            <Image source={{ uri: n.user.avatar }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarPlaceholder]} />
          )}
          {!following && (
            <TouchableOpacity
              style={styles.followBadge}
              onPress={() => setFollowing(true)}
            >
              <Ionicons name="add" size={14} color="#fff" />
            </TouchableOpacity>
          )}
        </View>

        <TouchableOpacity style={styles.actionBtn} onPress={handleLike} disabled={liking}>
          <Ionicons
            name={liked ? 'heart' : 'heart-outline'}
            size={34}
            color={liked ? '#FE2C55' : '#fff'}
          />
          <Text style={styles.actionText}>{formatCount(likesCount)}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionBtn}>
          <Ionicons name="chatbubble-ellipses" size={32} color="#fff" />
          <Text style={styles.actionText}>{formatCount(n.stats.comments)}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionBtn} onPress={handleSave} disabled={saving}>
          <Ionicons
            name={saved ? 'bookmark' : 'bookmark-outline'}
            size={32}
            color={saved ? '#face15' : '#fff'}
          />
          <Text style={styles.actionText}>{formatCount(n.stats.shares)}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionBtn}>
          <Ionicons name="arrow-redo" size={32} color="#fff" />
          <Text style={styles.actionText}>Paylaş</Text>
        </TouchableOpacity>

        {onDelete ? (
          <TouchableOpacity style={styles.actionBtn} onPress={onDelete} disabled={deleting}>
            <Ionicons name={deleting ? 'hourglass-outline' : 'trash-outline'} size={28} color={deleting ? 'rgba(255,255,255,0.6)' : '#fff'} />
            <Text style={styles.actionText}>{deleting ? 'Siliniyor' : 'Sil'}</Text>
          </TouchableOpacity>
        ) : null}

        <View style={styles.musicDisc}>
          {n.music.cover ? <Image source={{ uri: n.music.cover }} style={styles.musicCover} /> : null}
        </View>
      </View>

      {/* Alt bilgi */}
      <View style={styles.bottomInfo}>
        <Text style={styles.username}>
          {n.user.username}
          {n.user.isVerified ? ' ' : ''}
        </Text>
        {n.caption ? (
          <Text style={styles.caption} numberOfLines={2}>
            {n.caption}
          </Text>
        ) : null}
        <View style={styles.musicRow}>
          <Ionicons name={n.mediaType === 'image' ? 'image' : 'musical-notes'} size={14} color="#fff" />
          <Text style={styles.musicText} numberOfLines={1}>
            {n.mediaType === 'image' ? 'Fotoğraf gönderisi' : n.music.title}
          </Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#000',
  },
  background: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  actions: {
    position: 'absolute',
    right: 10,
    bottom: 110,
    alignItems: 'center',
  },
  avatarWrap: {
    alignItems: 'center',
    marginBottom: 18,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: '#fff',
  },
  followBadge: {
    position: 'absolute',
    bottom: -8,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#FE2C55',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtn: {
    alignItems: 'center',
    marginBottom: 16,
  },
  actionText: {
    color: '#fff',
    fontSize: 12,
    marginTop: 2,
    fontWeight: '500',
  },
  musicDisc: {
    marginTop: 6,
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 8,
    borderColor: '#222',
    overflow: 'hidden',
  },
  musicCover: {
    width: '100%',
    height: '100%',
  },
  bottomInfo: {
    position: 'absolute',
    left: 12,
    right: 80,
    bottom: 100,
  },
  username: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  caption: {
    color: '#fff',
    fontSize: 14,
    lineHeight: 19,
    marginBottom: 8,
  },
  musicRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  musicText: {
    color: '#fff',
    fontSize: 13,
    marginLeft: 6,
    flex: 1,
  },
});

export default VideoCard;
