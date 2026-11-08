import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

export default function GlowWrap({ children, style, radius = 12, color = 'rgba(255,255,255,0.55)' }) {
  const a = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(a, { toValue: 1, duration: 1600, useNativeDriver: true }),
        Animated.timing(a, { toValue: 0, duration: 1600, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [a]);

  const opacity = a.interpolate({ inputRange: [0, 1], outputRange: [0.18, 0.55] });
  const scale = a.interpolate({ inputRange: [0, 1], outputRange: [1, 1.035] });

  return (
    <View style={[styles.wrap, style]}>
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            borderRadius: radius,
            borderWidth: 1.5,
            borderColor: color,
            opacity,
            transform: [{ scale }],
            shadowColor: color,
            shadowOpacity: 0.9,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 0 },
          },
        ]}
      />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'relative' },
});
