import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  TextInput,
  Image,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import GlowWrap from '../components/GlowWrap';

const TOP = Platform.OS === 'ios' ? 54 : (StatusBar.currentHeight || 0) + 10;

function friendlyError(e) {
  const msg = String(e?.message || '');
  if (msg.toLowerCase().includes('bağlanılamadı') || msg.toLowerCase().includes('network request failed')) {
    return 'Yükleme sunucusuna bağlanılamadı. "tiktok-clone/server" çalışıyor mu ve cihaz aynı ağda mı?';
  }
  if (msg.includes('permission-denied') || String(e?.code || '').includes('permission-denied')) {
    return 'İzin hatası. Firestore "users" kurallarını kontrol edin.';
  }
  return e?.message || 'Kaydedilemedi. Lütfen tekrar deneyin.';
}

export default function EditProfileScreen({ navigation }) {
  const { user, updateUserProfile } = useAuth();
  const insets = useSafeAreaInsets();
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [username, setUsername] = useState(user?.username || '');
  const [bio, setBio] = useState(user?.bio || '');
  const [avatarPick, setAvatarPick] = useState(null); // { uri, mimeType }
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    setDisplayName(user.displayName || '');
    setUsername(user.username || '');
    setBio(user.bio || '');
  }, [user?.id]);

  const avatarSource = useMemo(() => {
    if (avatarPick?.uri) return { uri: avatarPick.uri };
    if (user?.avatar) return { uri: user.avatar };
    return null;
  }, [avatarPick, user?.avatar]);

  const pickAvatar = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('İzin gerekli', 'Profil fotoğrafı seçmek için medya izni verin.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
    });
    if (result.canceled || !result.assets?.[0]?.uri) return;
    const a = result.assets[0];
    setAvatarPick({ uri: a.uri, mimeType: a.mimeType || 'image/jpeg' });
  };

  const onSave = async () => {
    if (!user?.id) return;
    const dn = String(displayName || '').trim();
    const un = String(username || '').trim().toLowerCase().replace(/\s+/g, '_').replace(/^@/, '');
    if (!dn) { Alert.alert('Eksik bilgi', 'İsim boş olamaz.'); return; }
    if (!un) { Alert.alert('Eksik bilgi', 'Kullanıcı adı boş olamaz.'); return; }
    setSaving(true);
    try {
      await updateUserProfile({
        displayName: dn,
        username: un,
        bio,
        avatarUri: avatarPick?.uri || null,
        avatarMimeType: avatarPick?.mimeType || null,
      });
      Alert.alert('Kaydedildi', 'Profilin güncellendi.', [
        { text: 'Tamam', onPress: () => navigation.goBack() },
      ]);
    } catch (e) {
      Alert.alert('Kaydedilemedi', friendlyError(e));
    } finally {
      setSaving(false);
    }
  };

  if (!user) return null;

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar barStyle="light-content" />
      <View style={[styles.top, { paddingTop: TOP }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} disabled={saving}>
          <Ionicons name="chevron-back" size={28} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.title}>Profili düzenle</Text>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]} keyboardShouldPersistTaps="handled">
        <TouchableOpacity style={styles.avatarWrap} onPress={pickAvatar} disabled={saving}>
          {avatarSource ? (
            <Image source={avatarSource} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarPlaceholder]}>
              <Ionicons name="person" size={40} color="rgba(255,255,255,0.5)" />
            </View>
          )}
          <View style={styles.avatarBadge}>
            <Ionicons name="camera" size={14} color="#fff" />
          </View>
        </TouchableOpacity>
        <Text style={styles.avatarHint}>Fotoğrafı değiştir</Text>

        <View style={styles.field}>
          <Text style={styles.label}>İsim</Text>
          <TextInput
            style={styles.input}
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="Görünen ad"
            placeholderTextColor="rgba(255,255,255,0.35)"
            editable={!saving}
            maxLength={50}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Kullanıcı adı</Text>
          <TextInput
            style={styles.input}
            value={username}
            onChangeText={setUsername}
            placeholder="kullanici_adi"
            placeholderTextColor="rgba(255,255,255,0.35)"
            editable={!saving}
            autoCapitalize="none"
            maxLength={30}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Bio</Text>
          <TextInput
            style={[styles.input, styles.bioInput]}
            value={bio}
            onChangeText={setBio}
            placeholder="Kendinden bahset..."
            placeholderTextColor="rgba(255,255,255,0.35)"
            editable={!saving}
            multiline
            maxLength={150}
          />
          <Text style={styles.count}>{bio.length}/150</Text>
        </View>

        <GlowWrap radius={12} style={{ marginTop: 22 }}>
          <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.7 }]} onPress={onSave} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Kaydet</Text>}
          </TouchableOpacity>
        </GlowWrap>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.1)' },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { color: '#fff', fontSize: 17, fontWeight: '700' },
  scroll: { padding: 20 },
  avatarWrap: { alignSelf: 'center' },
  avatar: { width: 96, height: 96, borderRadius: 48, backgroundColor: '#222' },
  avatarPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  avatarBadge: { position: 'absolute', right: 0, bottom: 0, width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.55)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center' },
  avatarHint: { color: '#5ECFFF', textAlign: 'center', marginTop: 10, fontWeight: '600' },
  field: { marginTop: 18 },
  label: { color: 'rgba(255,255,255,0.6)', fontSize: 13, marginBottom: 8 },
  input: { color: '#fff', fontSize: 16, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12 },
  bioInput: { minHeight: 90, textAlignVertical: 'top' },
  count: { color: 'rgba(255,255,255,0.4)', fontSize: 12, textAlign: 'right', marginTop: 6 },
  saveBtn: { backgroundColor: 'rgba(255,255,255,0.16)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  saveText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  note: { color: 'rgba(255,255,255,0.45)', fontSize: 12, marginTop: 12, textAlign: 'center', lineHeight: 17 },
});
