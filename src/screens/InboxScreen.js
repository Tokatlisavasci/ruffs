import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  StatusBar,
  Image,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { useNotifications } from '../context/NotificationsContext';
import { fetchNotifications, markNotificationRead } from '../services/videos';

function timeAgo(ts) {
  try {
    const t = ts?.toMillis ? ts.toMillis() : (ts ? new Date(ts).getTime() : 0);
    if (!t) return '';
    const diff = Math.max(0, Date.now() - t);
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'şimdi';
    if (m < 60) return `${m}dk`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}sa`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d}g`;
    return `${Math.floor(d / 7)}h`;
  } catch { return ''; }
}

function notifText(n) {
  if (n?.type === 'new_follower') return 'seni takip etmeye başladı.';
  if (n?.type === 'like') return 'videonu beğendi.';
  if (n?.type === 'save') return 'videonu kaydetti.';
  return '';
}

const InboxScreen = () => {
  const navigation = useNavigation();
  const { user } = useAuth();
  const { setUnreadCount } = useNotifications() || {};
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = useState('main'); // main | followers | interactions

  const load = useCallback(async (silent = false) => {
    if (!user?.id) { setItems([]); setUnreadCount?.(0); return; }
    if (!silent) setLoading(true);
    try {
      const list = await fetchNotifications(user.id, 80);
      const arr = Array.isArray(list) ? list : [];
      setItems(arr);
      setUnreadCount?.(arr.filter((x) => !x.read).length);
    } catch {
      setItems([]);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [user?.id, setUnreadCount]);

  useFocusEffect(
    useCallback(() => {
      load(true);
    }, [load])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  };

  const openProfile = (fromUid) => {
    if (!fromUid) return;
    try {
      const parent = navigation.getParent?.();
      if (parent?.navigate) parent.navigate('UserProfile', { userId: fromUid });
      else navigation.navigate('UserProfile', { userId: fromUid });
    } catch {
      try { navigation.navigate('UserProfile', { userId: fromUid }); } catch {}
    }
  };

  const onPressNotif = async (n) => {
    if (!n?.read && user?.id && n?.id) {
      setItems((prev) => {
        const next = prev.map((x) => (x.id === n.id ? { ...x, read: true } : x));
        setUnreadCount?.(next.filter((x) => !x.read).length);
        return next;
      });
      markNotificationRead(user.id, n.id);
    }
    openProfile(n?.fromUid);
  };

  const followerNotifs = items.filter((n) => n.type === 'new_follower');
  const interactionNotifs = items.filter((n) => n.type === 'like' || n.type === 'save');
  const unreadFollowers = followerNotifs.filter((n) => !n.read).length;
  const unreadInteractions = interactionNotifs.filter((n) => !n.read).length;

  const renderNotif = (n) => {
    const name = n.fromDisplayName || (n.fromUsername ? `@${n.fromUsername}` : 'Bir kullanıcı');
    return (
      <TouchableOpacity key={n.id} style={styles.notifRow} onPress={() => onPressNotif(n)}>
        {n.fromAvatar ? (
          <Image source={{ uri: n.fromAvatar }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarPlaceholder]}>
            <Ionicons name="person" size={22} color="rgba(255,255,255,0.5)" />
          </View>
        )}
        <View style={styles.notifBody}>
          <Text style={styles.notifText} numberOfLines={2}>
            <Text style={styles.notifName}>{name}</Text> {notifText(n)}
          </Text>
        </View>
        {n.videoThumb ? <Image source={{ uri: n.videoThumb }} style={styles.thumb} /> : null}
        <View style={styles.msgMeta}>
          <Text style={styles.msgTime}>{timeAgo(n.createdAt)}</Text>
          {!n.read ? <View style={styles.dot} /> : null}
        </View>
      </TouchableOpacity>
    );
  };

  const subHeader = (title) => (
    <View style={styles.subHeader}>
      <TouchableOpacity onPress={() => setView('main')} style={styles.backBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
        <Ionicons name="chevron-back" size={26} color="#fff" />
      </TouchableOpacity>
      <Text style={styles.subHeaderTitle}>{title}</Text>
      <View style={styles.backBtn} />
    </View>
  );

  const listView = view === 'followers' ? followerNotifs : view === 'interactions' ? interactionNotifs : [];

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {view === 'main' ? (
        <View style={styles.header}>
          <View style={styles.headerSide} />
          <Text style={styles.headerTitle}>Gelen Kutusu</Text>
          <View style={styles.headerSideRight} />
        </View>
      ) : subHeader(view === 'followers' ? 'Yeni takipçiler' : 'Etkileşimler')}

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />}
      >
        {view === 'main' ? (
          <>
            <TouchableOpacity style={styles.activityRow} activeOpacity={0.85} onPress={() => setView('followers')}>
              <View style={[styles.activityIcon, { backgroundColor: '#4A90FF' }]}>
                <Ionicons name="person-add" size={22} color="#fff" />
              </View>
              <View style={styles.activityBody}>
                <Text style={styles.activityTitle}>Yeni takipçiler</Text>
                <Text style={styles.activityDesc}>Seni takip etmeye başlayanlar</Text>
              </View>
              {unreadFollowers > 0 ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{unreadFollowers > 99 ? '99+' : unreadFollowers}</Text>
                </View>
              ) : null}
              <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.35)" />
            </TouchableOpacity>

            <TouchableOpacity style={styles.activityRow} activeOpacity={0.85} onPress={() => setView('interactions')}>
              <View style={[styles.activityIcon, { backgroundColor: '#FE2C55' }]}>
                <Ionicons name="heart" size={22} color="#fff" />
              </View>
              <View style={styles.activityBody}>
                <Text style={styles.activityTitle}>Etkileşimler</Text>
                <Text style={styles.activityDesc}>Videolarını beğenenler ve kaydedenler</Text>
              </View>
              {unreadInteractions > 0 ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{unreadInteractions > 99 ? '99+' : unreadInteractions}</Text>
                </View>
              ) : null}
              <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.35)" />
            </TouchableOpacity>

            <Text style={styles.sectionLabel}>Mesajlar</Text>
            <Text style={styles.hint}>Mesajlar yakında.</Text>
          </>
        ) : (
          <>
            {loading && items.length === 0 ? <Text style={styles.hint}>Yükleniyor…</Text> : null}
            {!loading && listView.length === 0 ? (
              <Text style={styles.hint}>{view === 'followers' ? 'Henüz yeni takipçi bildirimin yok.' : 'Henüz etkileşim bildirimin yok.'}</Text>
            ) : null}
            {listView.map(renderNotif)}
          </>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', paddingTop: 48 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 10,
  },
  headerSide: { width: 32 },
  headerSideRight: { width: 32, alignItems: 'flex-end' },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  subHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 8, paddingBottom: 10,
  },
  subHeaderTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  backBtn: { width: 40, alignItems: 'center', justifyContent: 'center' },
  content: { paddingBottom: 110 },
  activityRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14 },
  activityIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  activityBody: { flex: 1, marginLeft: 12 },
  activityTitle: { color: '#fff', fontSize: 15, fontWeight: '600' },
  activityDesc: { color: 'rgba(255,255,255,0.55)', fontSize: 13, marginTop: 2 },
  badge: {
    backgroundColor: '#FE2C55', borderRadius: 10, minWidth: 20, height: 20,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, marginRight: 6,
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  hint: { color: 'rgba(255,255,255,0.45)', fontSize: 13, paddingHorizontal: 16, paddingVertical: 14 },
  notifRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#222' },
  avatarPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  notifBody: { flex: 1, marginLeft: 12 },
  notifText: { color: 'rgba(255,255,255,0.85)', fontSize: 14, lineHeight: 20 },
  notifName: { color: '#fff', fontWeight: '700' },
  thumb: { width: 40, height: 52, borderRadius: 4, backgroundColor: '#222', marginLeft: 8 },
  msgMeta: { alignItems: 'flex-end', marginLeft: 8, minWidth: 34 },
  msgTime: { color: 'rgba(255,255,255,0.45)', fontSize: 12 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FE2C55', marginTop: 8 },
  sectionLabel: { color: 'rgba(255,255,255,0.55)', fontSize: 13, fontWeight: '600', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 },
});

export default InboxScreen;
