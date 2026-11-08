import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  Platform,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';

const TOP = Platform.OS === 'ios' ? 54 : (StatusBar.currentHeight || 0) + 10;

export default function CameraPreviewTestScreen({ navigation }) {
  const cameraRef = useRef(null);
  const [facing, setFacing] = useState('back');
  const [permission, requestPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  const [ready, setReady] = useState(false);
  const [lastError, setLastError] = useState(null);

  const grantAll = async () => {
    const cam = permission?.granted ? permission : await requestPermission();
    const mic = micPermission?.granted ? micPermission : await requestMicPermission();
    if (!cam?.granted) {
      Alert.alert('Kamera izni gerekli', 'Kamera önizlemesini test etmek için izin verin.');
    }
    if (!mic?.granted) {
      // mic optional for preview
    }
  };

  if (!permission) {
    return (
      <View style={styles.center}>
        <StatusBar barStyle="light-content" />
        <Text style={styles.text}>İzin durumu yükleniyor...</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" />
        <View style={[styles.topBar, { paddingTop: TOP }]}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn}>
            <Ionicons name="chevron-back" size={28} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.title}>Kamera Testi</Text>
          <View style={styles.iconBtn} />
        </View>
        <View style={styles.center}>
          <Ionicons name="camera-outline" size={52} color="rgba(255,255,255,0.5)" />
          <Text style={[styles.text, { marginTop: 12, textAlign: 'center', paddingHorizontal: 24 }]}>
            Kamera önizlemesini denemek için izin gerekli. (Expo Go uyumlu: expo-camera)
          </Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={grantAll}>
            <Text style={styles.primaryBtnText}>İzin ver</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing={facing}
        mode="picture"
        onCameraReady={() => { setReady(true); setLastError(null); }}
        onMountError={(e) => { setLastError(String(e?.message || e)); console.log('camera mount error', e); }}
      />

      <View style={[styles.topBar, { paddingTop: TOP, position: 'absolute', left: 0, right: 0 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.circleBtn}>
          <Ionicons name="close" size={26} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.title}>Kamera Testi</Text>
        <View style={styles.circleBtn} />
      </View>

      <View style={styles.bottom}>
        <Text style={styles.statusText}>
          {lastError ? `Hata: ${lastError}` : ready ? 'Önizleme hazır' : 'Önizleme başlıyor...'}
        </Text>
        <View style={styles.row}>
          <TouchableOpacity
            style={styles.controlBtn}
            onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))}
          >
            <Ionicons name="camera-reverse-outline" size={24} color="#fff" />
            <Text style={styles.controlText}>Çevir</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  text: { color: 'rgba(255,255,255,0.8)', fontSize: 15 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 8 },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  circleBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  title: { color: '#fff', fontSize: 17, fontWeight: '700' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16, paddingBottom: Platform.OS === 'ios' ? 30 : 18, alignItems: 'center' },
  statusText: { color: '#fff', fontSize: 13, marginBottom: 12, textAlign: 'center', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4 },
  row: { flexDirection: 'row', gap: 16 },
  controlBtn: { alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.35)', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12 },
  controlText: { color: '#fff', marginTop: 4, fontSize: 12, fontWeight: '600' },
  primaryBtn: { marginTop: 16, backgroundColor: '#FE2C55', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 10 },
  primaryBtnText: { color: '#fff', fontWeight: '700' },
});
