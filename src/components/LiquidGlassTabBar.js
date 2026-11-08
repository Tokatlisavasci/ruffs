import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Animated,
  PanResponder,
  Platform,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useNotifications } from '../context/NotificationsContext';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const BAR_MARGIN = 18;
const BAR_HEIGHT = 52;
const BAR_RADIUS = 26;
const HIDDEN_ROUTES = new Set(['Arama']);

const TAB_ICONS = {
  Ana: { active: 'home', inactive: 'home-outline' },
  'İçerik': { active: 'add', inactive: 'add' },
  Mesajlar: { active: 'chatbubble-ellipses', inactive: 'chatbubble-ellipses-outline' },
  Profil: { active: 'person', inactive: 'person-outline' },
};

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

const LiquidGlassTabBar = ({ state, navigation }) => {
  const { unreadCount } = useNotifications() || {};
  const visible = state.routes
    .map((route, routeIndex) => ({ route, routeIndex }))
    .filter(({ route }) => !HIDDEN_ROUTES.has(route.name));

  const focusedRoute = state.routes[state.index];
  const focusedVisibleIndex = visible.findIndex((v) => v.route.key === focusedRoute?.key);

  const [barLayoutW, setBarLayoutW] = useState(SCREEN_WIDTH - BAR_MARGIN * 2);
  const tabW = visible.length > 0 ? barLayoutW / visible.length : barLayoutW;
  const maxX = Math.max(0, barLayoutW - tabW);

  const activeIndexForIndicator = focusedVisibleIndex >= 0 ? focusedVisibleIndex : 0;
  const indicatorX = useRef(new Animated.Value(activeIndexForIndicator * tabW)).current;
  const indicatorXValue = useRef(activeIndexForIndicator * tabW);
  const indicatorScale = useRef(new Animated.Value(1)).current;
  const indicatorOpacity = useRef(new Animated.Value(focusedVisibleIndex >= 0 ? 1 : 0)).current;
  const isDragging = useRef(false);
  const gestureStartFingerX = useRef(0);
  const gestureStartIndicatorX = useRef(0);

  useEffect(() => {
    const id = indicatorX.addListener(({ value }) => {
      indicatorXValue.current = value;
    });
    return () => indicatorX.removeListener(id);
  }, [indicatorX]);

  useEffect(() => {
    const show = focusedVisibleIndex >= 0;
    Animated.timing(indicatorOpacity, {
      toValue: show ? 1 : 0,
      duration: 140,
      useNativeDriver: true,
    }).start();
    if (isDragging.current || !show) return;
    const target = focusedVisibleIndex * tabW;
    indicatorXValue.current = target;
    Animated.spring(indicatorX, {
      toValue: target,
      useNativeDriver: true,
      tension: 170,
      friction: 15,
      overshootClamping: false,
    }).start();
  }, [focusedVisibleIndex, tabW, indicatorX, indicatorOpacity]);

  const snapToVisibleIndex = (vIndex, navigate = true) => {
    const safeIndex = clamp(vIndex, 0, visible.length - 1);
    const target = safeIndex * tabW;
    indicatorXValue.current = target;
    Animated.spring(indicatorX, {
      toValue: target,
      useNativeDriver: true,
      tension: 190,
      friction: 16,
      overshootClamping: false,
    }).start();

    const route = visible[safeIndex]?.route;
    if (navigate && route && route.key !== focusedRoute?.key) {
      navigation.navigate(route.name);
    }
  };

  const tabsResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 2 || Math.abs(g.dy) > 2,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (evt) => {
        isDragging.current = true;
        gestureStartFingerX.current = evt.nativeEvent.locationX;
        gestureStartIndicatorX.current = indicatorXValue.current;
        indicatorX.stopAnimation((val) => {
          indicatorXValue.current = val;
          gestureStartIndicatorX.current = val;
        });
        Animated.parallel([
          Animated.timing(indicatorOpacity, { toValue: 1, duration: 80, useNativeDriver: true }),
          Animated.spring(indicatorScale, {
            toValue: 1.03,
            useNativeDriver: true,
            tension: 240,
            friction: 14,
          }),
        ]).start();
      },
      onPanResponderMove: (evt) => {
        const dx = evt.nativeEvent.locationX - gestureStartFingerX.current;
        const next = clamp(gestureStartIndicatorX.current + dx, 0, maxX);
        indicatorX.setValue(next);
        indicatorXValue.current = next;
      },
      onPanResponderRelease: (evt) => {
        isDragging.current = false;
        const dx = evt.nativeEvent.locationX - gestureStartFingerX.current;
        const finalX = clamp(gestureStartIndicatorX.current + dx, 0, maxX);
        const index = clamp(Math.round(finalX / tabW), 0, visible.length - 1);
        Animated.spring(indicatorScale, {
          toValue: 1,
          useNativeDriver: true,
          tension: 240,
          friction: 14,
        }).start();
        snapToVisibleIndex(index, true);
      },
      onPanResponderTerminate: () => {
        isDragging.current = false;
        Animated.spring(indicatorScale, { toValue: 1, useNativeDriver: true, tension: 240, friction: 14 }).start();
        if (focusedVisibleIndex >= 0) snapToVisibleIndex(focusedVisibleIndex, false);
      },
    })
  ).current;

  return (
    <View style={styles.wrapper} pointerEvents="box-none">
      <View
        style={styles.bar}
        onLayout={(e) => setBarLayoutW(e.nativeEvent.layout.width)}
      >
        <View style={[StyleSheet.absoluteFill, styles.clip]}>
          <BlurView
            intensity={Platform.OS === 'web' ? 28 : 45}
            tint="dark"
            style={StyleSheet.absoluteFill}
          />
          <LinearGradient
            colors={[
              'rgba(255,255,255,0.045)',
              'rgba(255,255,255,0.02)',
              'rgba(0,0,0,0.02)',
              'rgba(0,0,0,0.04)',
            ]}
            locations={[0, 0.35, 0.7, 1]}
            style={StyleSheet.absoluteFill}
          />
        </View>

        <Animated.View
          pointerEvents="none"
          style={[
            styles.indicatorWrap,
            {
              width: tabW,
              opacity: indicatorOpacity,
              transform: [{ translateX: indicatorX }, { scaleX: indicatorScale }],
            },
          ]}
        >
          <View style={styles.indicator} />
        </Animated.View>

        <View style={styles.tabsRow} {...tabsResponder.panHandlers}>
          {visible.map(({ route }, vIndex) => {
            const isFocused = focusedVisibleIndex === vIndex;
            const meta = TAB_ICONS[route.name] || { active: 'ellipse', inactive: 'ellipse-outline' };
            const isCreate = route.name === 'İçerik';

            if (isCreate) {
              return (
                <TouchableOpacity
                  key={route.key}
                  accessibilityRole="button"
                  onPress={() => snapToVisibleIndex(vIndex, true)}
                  style={[styles.tabItem, { width: tabW }]}
                  activeOpacity={0.85}
                >
                  <View style={styles.createButton}>
                    <Ionicons name="add" size={22} color="#000" />
                  </View>
                </TouchableOpacity>
              );
            }

            return (
              <TouchableOpacity
                key={route.key}
                accessibilityRole="button"
                accessibilityState={isFocused ? { selected: true } : {}}
                onPress={() => snapToVisibleIndex(vIndex, true)}
                style={[styles.tabItem, { width: tabW }]}
                activeOpacity={0.85}
              >
                <View>
                  <Ionicons
                    name={isFocused ? meta.active : meta.inactive}
                    size={24}
                    color={isFocused ? '#FFFFFF' : 'rgba(255,255,255,0.62)'}
                  />
                  {route.name === 'Mesajlar' && unreadCount > 0 ? (
                    <View style={styles.badge}>
                      <View style={styles.badgeDot} />
                    </View>
                  ) : null}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: BAR_MARGIN,
    right: BAR_MARGIN,
    bottom: Platform.OS === 'ios' ? 22 : 14,
  },
  bar: {
    height: BAR_HEIGHT,
    borderRadius: BAR_RADIUS,
    backgroundColor: 'transparent',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 0,
  },
  clip: {
    borderRadius: BAR_RADIUS,
    overflow: 'hidden',
  },
  indicatorWrap: {
    position: 'absolute',
    top: 6,
    bottom: 6,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  indicator: {
    width: '68%',
    height: '100%',
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  tabsRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  tabItem: {
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  createButton: {
    width: 40,
    height: 30,
    borderRadius: 10,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: -6,
  },
  badgeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FE2C55',
  },
});

export default LiquidGlassTabBar;
