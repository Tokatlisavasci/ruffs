import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  StatusBar,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const InboxScreen = () => {
  const activities = [
    { id: 'a1', icon: 'person-add', color: '#4A90FF', title: 'Yeni takipçiler', desc: 'Seni takip edenleri gör', badge: 2 },
    { id: 'a2', icon: 'notifications', color: '#FE2C55', title: 'Etkinlikler', desc: 'Beğeniler, yorumlar ve bahsetmeler', badge: 5 },
  ];

  const messages = [
    { id: '1', avatar: 'https://i.pravatar.cc/150?img=11', name: 'Emre Yılmaz', text: 'Video harika olmuş! 🔥', time: '2dk', unread: true },
    { id: '2', avatar: 'https://i.pravatar.cc/150?img=12', name: 'Aylin Demir', text: 'Birlikte çekim yapalım mı?', time: '1sa', unread: true },
    { id: '3', avatar: 'https://i.pravatar.cc/150?img=13', name: 'Mehmet Koç', text: 'Tebrikler, çok iyi gidiyor', time: '3sa', unread: false },
    { id: '4', avatar: 'https://i.pravatar.cc/150?img=14', name: 'Zeynep Tan', text: 'Hangi şarkıyı kullandın?', time: 'dün', unread: false },
    { id: '5', avatar: 'https://i.pravatar.cc/150?img=15', name: 'Can Sert', text: 'Takipte kal!', time: 'dün', unread: false },
  ];

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Başlık */}
      <View style={styles.header}>
        <View style={styles.headerSide} />
        <Text style={styles.headerTitle}>Gelen Kutusu</Text>
        <TouchableOpacity style={styles.headerSideRight}>
          <Ionicons name="create-outline" size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        {/* Etkinlik satırları */}
        {activities.map((a) => (
          <TouchableOpacity key={a.id} style={styles.activityRow}>
            <View style={[styles.activityIcon, { backgroundColor: a.color }]}>
              <Ionicons name={a.icon} size={22} color="#fff" />
            </View>
            <View style={styles.activityBody}>
              <Text style={styles.activityTitle}>{a.title}</Text>
              <Text style={styles.activityDesc}>{a.desc}</Text>
            </View>
            {a.badge ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{a.badge}</Text>
              </View>
            ) : null}
            <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.35)" />
          </TouchableOpacity>
        ))}

        <Text style={styles.sectionLabel}>Mesajlar</Text>

        {/* Mesaj listesi */}
        {messages.map((m) => (
          <TouchableOpacity key={m.id} style={styles.msgRow}>
            <Image source={{ uri: m.avatar }} style={styles.avatar} />
            <View style={styles.msgBody}>
              <Text style={styles.msgName}>{m.name}</Text>
              <Text style={[styles.msgText, m.unread && styles.msgTextUnread]} numberOfLines={1}>
                {m.text}
              </Text>
            </View>
            <View style={styles.msgMeta}>
              <Text style={styles.msgTime}>{m.time}</Text>
              {m.unread ? <View style={styles.dot} /> : null}
            </View>
          </TouchableOpacity>
        ))}
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
    paddingBottom: 10,
  },
  headerSide: { width: 32 },
  headerSideRight: { width: 32, alignItems: 'flex-end' },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  content: {
    paddingBottom: 110,
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  activityIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activityBody: {
    flex: 1,
    marginLeft: 12,
  },
  activityTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  activityDesc: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 13,
    marginTop: 2,
  },
  badge: {
    backgroundColor: '#FE2C55',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    marginRight: 8,
  },
  badgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  sectionLabel: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 13,
    fontWeight: '600',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 6,
  },
  msgRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#222',
  },
  msgBody: {
    flex: 1,
    marginLeft: 12,
  },
  msgName: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  msgText: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 14,
    marginTop: 2,
  },
  msgTextUnread: {
    color: 'rgba(255,255,255,0.85)',
  },
  msgMeta: {
    alignItems: 'flex-end',
    marginLeft: 8,
  },
  msgTime: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 12,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FE2C55',
    marginTop: 8,
  },
});

export default InboxScreen;
