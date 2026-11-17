import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  ScrollView,
  Image,
  TouchableOpacity,
  Dimensions,
  StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { videos } from '../data/videos';

const { width } = Dimensions.get('window');
const GAP = 2;
const COL = (width - GAP) / 2;

const DiscoverScreen = () => {
  const items = [...videos, ...videos, ...videos];

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Arama */}
      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={18} color="rgba(255,255,255,0.6)" />
          <TextInput
            placeholder="Ara"
            placeholderTextColor="rgba(255,255,255,0.45)"
            style={styles.searchInput}
          />
          <Ionicons name="scan-outline" size={20} color="rgba(255,255,255,0.7)" />
        </View>
      </View>

      {/* Kategoriler */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
      >
        {['Sizin için', 'Trendler', 'Canlı', 'Spor', 'Yemek', 'Komedi', 'Müzik'].map((c, i) => (
          <TouchableOpacity key={c} style={[styles.chip, i === 0 && styles.chipActive]}>
            <Text style={[styles.chipText, i === 0 && styles.chipTextActive]}>{c}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Izgara */}
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.gridWrap}>
        <View style={styles.grid}>
          {items.map((v, i) => (
            <TouchableOpacity
              key={`${v.id}-${i}`}
              style={[styles.card, (i % 2 === 1) && { marginRight: 0 }]}
            >
              <Image source={{ uri: v.thumbnail }} style={styles.cardImg} resizeMode="cover" />
              <View style={styles.cardOverlay}>
                <Ionicons name="play-outline" size={14} color="#fff" />
                <Text style={styles.cardViews}>{v.stats.views}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
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
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 8,
    paddingHorizontal: 10,
    height: 38,
  },
  searchInput: {
    flex: 1,
    color: '#fff',
    fontSize: 15,
    marginHorizontal: 8,
    paddingVertical: 0,
  },
  chips: {
    paddingHorizontal: 12,
    paddingBottom: 10,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginRight: 8,
  },
  chipActive: {
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  chipText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    fontWeight: '600',
  },
  chipTextActive: {
    color: '#fff',
  },
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
  },
  cardImg: {
    width: '100%',
    height: '100%',
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
});

export default DiscoverScreen;
