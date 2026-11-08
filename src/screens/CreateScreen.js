import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Image,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useAuth } from '../context/AuthContext';
import { uploadUserMedia, inferMediaType } from '../services/videos';
import { isFirebaseConfigured } from '../config/firebase';
import GlowWrap from '../components/GlowWrap';

const { width: W, height: H } = Dimensions.get('window');
const TOP = Platform.OS === 'ios' ? 54 : (StatusBar.currentHeight || 0) + 10;
const TAB_BAR_H = 52 + (Platform.OS === 'ios' ? 14 : 8);

const EFFECTS = [
  { id: 'none', label: 'Normal', overlay: null, icon: 'color-filter-outline' },
  { id: 'warm', label: 'Sıcak', overlay: 'rgba(255, 150, 60, 0.18)', icon: 'sunny-outline' },
  { id: 'cool', label: 'Soğuk', overlay: 'rgba(60, 140, 255, 0.16)', icon: 'snow-outline' },
  { id: 'rose', label: 'Gül', overlay: 'rgba(255, 80, 140, 0.14)', icon: 'flower-outline' },
  { id: 'fade', label: 'Soluk', overlay: 'rgba(255, 255, 255, 0.12)', icon: 'partly-sunny-outline' },
  { id: 'dark', label: 'Koyu', overlay: 'rgba(0, 0, 0, 0.22)', icon: 'moon-outline' },
  { id: 'vivid', label: 'Canlı', overlay: 'rgba(255, 220, 80, 0.12)', icon: 'sparkles-outline' },
];

function friendlyUploadError(e) {
  const msg = String(e?.message || '');
  const code = String(e?.code || '');
  if (code.includes('permission-denied') || msg.includes('Missing or insufficient permissions')) {
    return 'İzin hatası. Firestore "videos" kurallarını kontrol edin.';
  }
  if (code.includes('unauthenticated')) return 'Oturum gerekli. Lütfen tekrar giriş yapın.';
  if (msg.toLowerCase().includes('bağlanılamadı') || msg.toLowerCase().includes('network request failed')) {
    return 'Yükleme sunucusuna bağlanılamadı. Bilgisayarda "tiktok-clone/server" çalışmalı ve EXPO_PUBLIC_SIGNING_API_URL doğru olmalı.';
  }
  if (msg.toLowerCase().includes('network')) return 'Ağ hatası. Bağlantınızı kontrol edin.';
  return e?.message || 'Yükleme başarısız. Lütfen tekrar deneyin.';
}

function FullMedia({ uri, mediaType, active, effectOverlay, muted }) {
  const player = useVideoPlayer(null, (p) => {
    p.loop = true;
    p.muted = !!muted;
  });
  useEffect(() => {
    if (mediaType !== 'video' || !uri) return;
    try { player.replace(uri); } catch {}
  }, [uri, mediaType, player]);
  useEffect(() => {
    if (mediaType !== 'video' || !uri) return;
    try { player.muted = !!muted; } catch {}
  }, [muted, mediaType, uri, player]);
  useEffect(() => {
    if (mediaType !== 'video' || !uri) return;
    try {
      if (active) player.play();
      else player.pause();
    } catch {}
  }, [active, mediaType, uri, player]);

  const fill = { position: 'absolute', top: 0, left: 0, width: W, height: H };
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }]} collapsable={false}>
      {mediaType === 'video' ? (
        <VideoView
          player={player}
          style={fill}
          contentFit="contain"
          nativeControls={false}
          allowsFullscreen={false}
          allowsPictureInPicture={false}
        />
      ) : uri ? (
        <Image source={{ uri }} style={fill} resizeMode="contain" />
      ) : null}
      {effectOverlay ? <View pointerEvents="none" style={[fill, { backgroundColor: effectOverlay }]} /> : null}
    </View>
  );
}

function RightTool({ icon, label, onPress }) {
  return (
    <TouchableOpacity style={styles.toolBtn} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.toolIconWrap}>
        <Ionicons name={icon} size={24} color="#fff" />
      </View>
      {label ? <Text style={styles.toolLabel}>{label}</Text> : null}
    </TouchableOpacity>
  );
}

const CreateScreen = ({ navigation }) => {
  const { user } = useAuth();
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, 4) + TAB_BAR_H;
  const cameraRef = useRef(null);
  const [camPermission, requestCamPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();

  const [step, setStep] = useState('camera'); // camera | preview | post
  const [picked, setPicked] = useState(null); // { uri, mediaType, mimeType }
  const [caption, setCaption] = useState('');
  const [uploading, setUploading] = useState(false);
  const [effectId, setEffectId] = useState('none');
  const [showEffects, setShowEffects] = useState(false);
  const [muted, setMuted] = useState(false);

  const [facing, setFacing] = useState('back');
  const [captureMode, setCaptureMode] = useState('photo'); // photo | video
  const [recording, setRecording] = useState(false);
  const [camReady, setCamReady] = useState(false);
  const [busyCapture, setBusyCapture] = useState(false);

  const effect = useMemo(() => EFFECTS.find((e) => e.id === effectId) || EFFECTS[0], [effectId]);

  // auto-request camera permission when camera screen is active
  useEffect(() => {
    if (!isFocused || step !== 'camera') return;
    (async () => {
      try {
        if (!camPermission?.granted) await requestCamPermission();
        if (!micPermission?.granted) await requestMicPermission();
      } catch {}
    })();
  }, [isFocused, step]);

  useEffect(() => {
    if (!isFocused && recording) {
      try { cameraRef.current?.stopRecording?.(); } catch {}
      setRecording(false);
    }
  }, [isFocused, recording]);

  const ensureReady = () => {
    if (!isFirebaseConfigured) {
      Alert.alert('Yapılandırma gerekli', 'Firebase ayarlarını (.env) tamamlayın.');
      return false;
    }
    if (!user?.id) {
      Alert.alert('Oturum gerekli', 'Paylaşmak için giriş yapın.');
      return false;
    }
    return true;
  };

  const goPreview = (asset) => {
    setPicked(asset);
    setEffectId('none');
    setShowEffects(false);
    setMuted(false);
    setStep('preview');
  };

  const pickFromGallery = async () => {
    if (!ensureReady()) return;
    if (recording) {
      try { cameraRef.current?.stopRecording?.(); } catch {}
      setRecording(false);
    }
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('İzin gerekli', 'Galeriden seçmek için medya izni vermeniz gerekiyor.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      allowsEditing: false,
      quality: 1,
    });
    if (result.canceled || !result.assets?.[0]?.uri) return;
    const a = result.assets[0];
    const mimeType = a.mimeType || null;
    const mediaType = a.type === 'video' || a.type === 'image' ? a.type : inferMediaType({ uri: a.uri, mimeType });
    goPreview({ uri: a.uri, mediaType, mimeType });
  };

  const takePhoto = async () => {
    if (!camPermission?.granted || !cameraRef.current || busyCapture) return;
    setBusyCapture(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.9 });
      if (photo?.uri) goPreview({ uri: photo.uri, mediaType: 'image', mimeType: 'image/jpeg' });
    } catch (e) {
      Alert.alert('Çekim hatası', String(e?.message || e));
    } finally {
      setBusyCapture(false);
    }
  };

  const toggleVideoRecord = async () => {
    if (!camPermission?.granted || !cameraRef.current || busyCapture) return;
    if (recording) {
      try { cameraRef.current.stopRecording(); } catch {}
      return;
    }
    if (!micPermission?.granted) {
      try { await requestMicPermission(); } catch {}
    }
    setRecording(true);
    try {
      const video = await cameraRef.current.recordAsync();
      if (video?.uri) goPreview({ uri: video.uri, mediaType: 'video', mimeType: 'video/mp4' });
    } catch (e) {
      if (String(e?.message || '').toLowerCase().includes('cancel')) {
        // ignore
      } else {
        Alert.alert('Kayıt hatası', String(e?.message || e));
      }
    } finally {
      setRecording(false);
    }
  };

  const onCapturePress = () => {
    if (captureMode === 'photo') takePhoto();
    else toggleVideoRecord();
  };

  const resetAll = () => {
    if (recording) {
      try { cameraRef.current?.stopRecording?.(); } catch {}
      setRecording(false);
    }
    setPicked(null);
    setCaption('');
    setEffectId('none');
    setShowEffects(false);
    setMuted(false);
    setStep('camera');
  };

  const onUpload = async () => {
    if (!picked?.uri || !user?.id) return;
    setUploading(true);
    try {
      await uploadUserMedia({ uri: picked.uri, caption, user, mediaType: picked.mediaType, mimeType: picked.mimeType });
      resetAll();
      Alert.alert('Paylaşıldı', 'İçeriğin profilinde ve ana sayfada görünecek.', [
        { text: 'Profile git', onPress: () => navigation.navigate('Profil') },
        { text: 'Tamam' },
      ]);
    } catch (e) {
      Alert.alert('Yükleme başarısız', friendlyUploadError(e));
    } finally {
      setUploading(false);
    }
  };

  const notNow = () => Alert.alert('Yakında', 'Bu araç şu an önizlemede sınırlı.');

  // CAMERA (default, TikTok-style)
  if (step === 'camera') {
    const permReady = !!camPermission;
    const camGranted = !!camPermission?.granted;
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" />
        {isFocused && camGranted ? (
          <CameraView
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            facing={facing}
            mode={captureMode === 'video' ? 'video' : 'picture'}
            onCameraReady={() => setCamReady(true)}
            onMountError={(e) => console.log('camera mount error', e)}
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }]} />
        )}

        {/* top */}
        <View style={[styles.camTop, { paddingTop: TOP }]}>
          <TouchableOpacity onPress={() => navigation.navigate('Ana Sayfa', { screen: 'Ana' })} style={styles.circleBtn}>
            <Ionicons name="close" size={26} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.soundPill} onPress={notNow}>
            <Ionicons name="musical-notes" size={14} color="#fff" />
            <Text style={styles.soundPillText}>Ses ekle</Text>
          </TouchableOpacity>
          <View style={styles.circleBtn} />
        </View>

        {/* right tools */}
        <View style={styles.camRight}>
          <RightTool icon="camera-reverse-outline" label="Çevir" onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))} />
          <RightTool icon="flash-outline" label="Flaş" onPress={notNow} />
          <RightTool icon="timer-outline" label="Zaman" onPress={notNow} />
        </View>

        {!permReady ? (
          <View style={styles.centerMsg}><Text style={styles.permText}>İzin durumu yükleniyor...</Text></View>
        ) : !camGranted ? (
          <View style={styles.centerMsg}>
            <Ionicons name="camera-outline" size={46} color="rgba(255,255,255,0.6)" />
            <Text style={styles.permText}>Kamera önizlemesi için izin verin.</Text>
            <GlowWrap radius={10} style={{ marginTop: 14 }}>
              <TouchableOpacity style={[styles.permBtn, { marginTop: 0 }]} onPress={async () => { await requestCamPermission(); await requestMicPermission(); }}>
                <Text style={styles.permBtnText}>İzin ver</Text>
              </TouchableOpacity>
            </GlowWrap>
            <TouchableOpacity style={styles.permLink} onPress={pickFromGallery}>
              <Text style={styles.permLinkText}>veya galeriden yükle</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* bottom */}
        <View style={[styles.camBottom, { paddingBottom: bottomPad }]}>
          <View style={styles.modeRow}>
            <TouchableOpacity onPress={() => { if (!recording) setCaptureMode('photo'); }}>
              <Text style={[styles.modeText, captureMode === 'photo' && styles.modeTextActive]}>FOTOĞRAF</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { if (!recording) setCaptureMode('video'); }}>
              <Text style={[styles.modeText, captureMode === 'video' && styles.modeTextActive]}>VİDEO</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.captureRow}>
            <TouchableOpacity style={styles.galleryBtn} onPress={pickFromGallery} disabled={recording || busyCapture}>
              <View style={styles.galleryThumb}>
                <Ionicons name="images" size={22} color="#fff" />
              </View>
              <Text style={styles.galleryLabel}>Yükle</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.captureOuter, recording && styles.captureOuterRec]}
              onPress={onCapturePress}
              activeOpacity={0.8}
              disabled={busyCapture || !camGranted}
            >
              <View style={[
                styles.captureInner,
                captureMode === 'video' && !recording && styles.captureInnerVideo,
                recording && styles.captureInnerRec,
                busyCapture && { opacity: 0.6 },
              ]} />
            </TouchableOpacity>

            <View style={styles.galleryBtn} />
          </View>

          {recording ? <Text style={styles.recHint}>Kaydediliyor… Durdurmak için dokun</Text>
            : <Text style={styles.recHint}>{captureMode === 'photo' ? 'Fotoğraf çekmek için dokun' : 'Kaydı başlat/durdur'}</Text>}
        </View>
      </View>
    );
  }

  // PREVIEW (TikTok-style)
  if (step === 'preview') {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" />
        <FullMedia uri={picked?.uri} mediaType={picked?.mediaType} active={isFocused} effectOverlay={effect.overlay} muted={muted} />

        <View style={[styles.previewTop, { paddingTop: TOP }]}>
          <TouchableOpacity onPress={resetAll} style={styles.circleBtn}>
            <Ionicons name="close" size={26} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.soundPill} onPress={notNow}>
            <Ionicons name="musical-notes" size={14} color="#fff" />
            <Text style={styles.soundPillText}>Ses ekle</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={pickFromGallery} style={styles.circleBtn}>
            <Ionicons name="images-outline" size={22} color="#fff" />
          </TouchableOpacity>
        </View>

        <View style={styles.rightTools}>
          <RightTool icon="color-filter" label="Filtre" onPress={() => setShowEffects((v) => !v)} />
          <RightTool icon="text" label="Metin" onPress={notNow} />
          <RightTool icon="happy-outline" label="Çıkartma" onPress={notNow} />
          {picked?.mediaType === 'video' ? (
            <RightTool icon={muted ? 'volume-mute' : 'volume-high'} label={muted ? 'Kapalı' : 'Ses'} onPress={() => setMuted((m) => !m)} />
          ) : null}
        </View>

        <View style={[styles.previewBottom, { paddingBottom: bottomPad }]}>
          {showEffects ? (
            <View style={styles.effectsPanel}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.effectsRow}>
                {EFFECTS.map((ef) => (
                  <TouchableOpacity key={ef.id} style={[styles.effectChip, effectId === ef.id && styles.effectChipActive]} onPress={() => setEffectId(ef.id)}>
                    <View style={[styles.effectSwatch, { backgroundColor: ef.overlay || 'rgba(255,255,255,0.1)' }]}>
                      <Ionicons name={ef.icon} size={14} color="#fff" />
                    </View>
                    <Text style={[styles.effectLabel, effectId === ef.id && styles.effectLabelActive]}>{ef.label}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <Text style={styles.effectsNote}>Filtre önizlemede uygulanır.</Text>
            </View>
          ) : null}
          <View style={styles.bottomBar}>
            <TouchableOpacity style={styles.bottomSmall} onPress={() => setShowEffects((v) => !v)}>
              <Ionicons name="color-filter-outline" size={20} color="#fff" />
              <Text style={styles.bottomSmallText}>Efektler</Text>
            </TouchableOpacity>
            <GlowWrap radius={10}>
              <TouchableOpacity style={styles.nextBtn} onPress={() => setStep('post')}>
                <Text style={styles.nextBtnText}>Sonraki</Text>
                <Ionicons name="chevron-forward" size={18} color="#fff" />
              </TouchableOpacity>
            </GlowWrap>
          </View>
        </View>
      </View>
    );
  }

  // POST
  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar barStyle="light-content" />
      <View style={[styles.simpleTop, { paddingTop: TOP }]}>
        <TouchableOpacity onPress={() => setStep('preview')} style={styles.iconBtn} disabled={uploading}>
          <Ionicons name="chevron-back" size={28} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.title}>Gönderi</Text>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView contentContainerStyle={[styles.postScroll, { paddingBottom: bottomPad + 90 }]} keyboardShouldPersistTaps="handled">
        <View style={styles.postRow}>
          <TextInput
            style={styles.captionInput}
            placeholder="Etkileyici bir açıklama yaz..."
            placeholderTextColor="rgba(255,255,255,0.45)"
            value={caption}
            onChangeText={setCaption}
            multiline
            maxLength={2200}
            editable={!uploading}
          />
          <View style={styles.thumbWrap}>
            {picked?.mediaType === 'video' ? (
              <View style={[styles.thumb, styles.thumbVideo]}>
                <Ionicons name="videocam" size={22} color="#fff" />
              </View>
            ) : (
              <Image source={{ uri: picked?.uri }} style={styles.thumb} />
            )}
            {effect.overlay ? <View pointerEvents="none" style={[styles.thumb, { backgroundColor: effect.overlay }]} /> : null}
          </View>
        </View>

        <View style={styles.postItem}>
          <Ionicons name="pricetag-outline" size={20} color="#fff" />
          <Text style={styles.postItemText}># Etiketler ve bahset</Text>
        </View>
        <View style={styles.postItem}>
          <Ionicons name="location-outline" size={20} color="#fff" />
          <Text style={styles.postItemText}>Konum ekle</Text>
        </View>
        <View style={styles.postItem}>
          <Ionicons name="lock-closed-outline" size={20} color="#fff" />
          <Text style={styles.postItemText}>Herkese açık</Text>
        </View>

        {uploading ? <Text style={styles.uploadingHint}>Yükleniyor, lütfen bekleyin...</Text> : null}
      </ScrollView>

      <View style={[styles.postFooter, { paddingBottom: bottomPad }]}>
        <TouchableOpacity style={styles.draftsBtn} onPress={() => Alert.alert('Taslak', 'Taslak kaydetme yakında.')} disabled={uploading}>
          <Text style={styles.draftsBtnText}>Taslaklar</Text>
        </TouchableOpacity>
        <GlowWrap radius={10} style={{ flex: 1.4 }}>
          <TouchableOpacity style={[styles.publishBtn, { flex: 0, width: '100%' }, uploading && styles.uploadActionDisabled]} onPress={onUpload} disabled={uploading}>
            {uploading ? <ActivityIndicator color="#fff" /> : (
              <>
                <Ionicons name="arrow-up-circle" size={18} color="#fff" />
                <Text style={styles.publishBtnText}>Paylaş</Text>
              </>
            )}
          </TouchableOpacity>
        </GlowWrap>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { color: '#fff', fontSize: 17, fontWeight: '700' },
  simpleTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 8 },

  camTop: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, zIndex: 5 },
  circleBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  soundPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.35)', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16 },
  soundPillText: { color: '#fff', fontWeight: '600', fontSize: 13 },

  camRight: { position: 'absolute', right: 10, top: TOP + 60, alignItems: 'center', gap: 18, zIndex: 5 },
  toolBtn: { alignItems: 'center' },
  toolIconWrap: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.28)', alignItems: 'center', justifyContent: 'center' },
  toolLabel: { color: '#fff', fontSize: 11, marginTop: 4, fontWeight: '600', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4 },

  centerMsg: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  permText: { color: 'rgba(255,255,255,0.85)', fontSize: 15, textAlign: 'center', marginTop: 10 },
  permBtn: { marginTop: 14, backgroundColor: 'rgba(255,255,255,0.16)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 10 },
  permBtnText: { color: '#fff', fontWeight: '700' },
  permLink: { marginTop: 12, padding: 8 },
  permLinkText: { color: '#5ECFFF', fontWeight: '600' },

  camBottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingBottom: 0, alignItems: 'center', zIndex: 5 },
  modeRow: { flexDirection: 'row', gap: 18, marginBottom: 14 },
  modeText: { color: 'rgba(255,255,255,0.55)', fontWeight: '700', fontSize: 13, letterSpacing: 0.5 },
  modeTextActive: { color: '#fff' },
  captureRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%', paddingHorizontal: 34 },
  galleryBtn: { width: 64, alignItems: 'center' },
  galleryThumb: { width: 44, height: 44, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.15)', borderWidth: 2, borderColor: 'rgba(255,255,255,0.7)', alignItems: 'center', justifyContent: 'center' },
  galleryLabel: { color: '#fff', fontSize: 11, marginTop: 4, fontWeight: '600' },
  captureOuter: { width: 78, height: 78, borderRadius: 39, borderWidth: 4, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  captureOuterRec: { borderColor: '#FE2C55' },
  captureInner: { width: 62, height: 62, borderRadius: 31, backgroundColor: '#fff' },
  captureInnerVideo: { backgroundColor: '#FE2C55' },
  captureInnerRec: { width: 30, height: 30, borderRadius: 6, backgroundColor: '#FE2C55' },
  recHint: { color: 'rgba(255,255,255,0.8)', fontSize: 12, marginTop: 10, minHeight: 16 },

  previewTop: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12 },
  rightTools: { position: 'absolute', right: 10, bottom: 150, alignItems: 'center', gap: 18 },
  previewBottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingBottom: 0 },
  effectsPanel: { paddingHorizontal: 12, paddingBottom: 8 },
  effectsRow: { paddingRight: 8 },
  effectChip: { alignItems: 'center', marginRight: 10, padding: 8, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.35)', minWidth: 62, borderWidth: 1, borderColor: 'transparent' },
  effectChipActive: { borderColor: '#FE2C55', backgroundColor: 'rgba(254,44,85,0.22)' },
  effectSwatch: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  effectLabel: { color: 'rgba(255,255,255,0.8)', fontSize: 11, marginTop: 5 },
  effectLabelActive: { color: '#fff', fontWeight: '700' },
  effectsNote: { color: 'rgba(255,255,255,0.55)', fontSize: 11, marginTop: 6 },
  bottomBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14 },
  bottomSmall: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.35)', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10 },
  bottomSmallText: { color: '#fff', fontWeight: '600' },
  nextBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.16)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)', paddingHorizontal: 22, paddingVertical: 12, borderRadius: 10 },
  nextBtnText: { color: '#fff', fontWeight: '800', fontSize: 16 },

  postScroll: { padding: 16, paddingBottom: 120 },
  postRow: { flexDirection: 'row', gap: 12 },
  captionInput: { flex: 1, minHeight: 110, color: '#fff', fontSize: 15, textAlignVertical: 'top', paddingTop: 4 },
  thumbWrap: { width: 86, height: 110, borderRadius: 6, overflow: 'hidden', backgroundColor: '#222' },
  thumb: { width: '100%', height: '100%', position: 'absolute' },
  thumbVideo: { position: 'relative', alignItems: 'center', justifyContent: 'center' },
  postItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.12)' },
  postItemText: { color: '#fff', fontSize: 15 },
  uploadingHint: { color: 'rgba(255,255,255,0.6)', fontSize: 13, marginTop: 10 },
  postFooter: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', gap: 12, padding: 14, paddingBottom: 0, backgroundColor: '#000', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.1)' },
  draftsBtn: { flex: 1, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 4, paddingVertical: 14, alignItems: 'center' },
  draftsBtnText: { color: '#fff', fontWeight: '700' },
  publishBtn: { flex: 1.4, backgroundColor: 'rgba(255,255,255,0.16)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)', borderRadius: 10, paddingVertical: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 },
  publishBtnText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  uploadActionDisabled: { opacity: 0.7 },
});

export default CreateScreen;
