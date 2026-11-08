import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useAuth } from '../context/AuthContext';
import GlowWrap from '../components/GlowWrap';

function friendlyAuthError(e) {
  const code = e?.code || '';
  if (code.includes('email-already-in-use')) return 'Bu e-posta zaten kayıtlı';
  if (code.includes('invalid-email')) return 'Geçerli bir e-posta girin';
  if (code.includes('weak-password')) return 'Şifre en az 6 karakter olmalı';
  if (code.includes('network')) return 'Ağ hatası. Bağlantınızı kontrol edin';
  return e?.message || 'Kayıt olunamadı';
}

const RegisterScreen = ({ navigation }) => {
  const { register, isConfigured } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const onSubmit = async () => {
    setError('');
    if (!isConfigured) {
      setError('Firebase yapılandırılmadı. .env dosyasına proje ayarlarını ekleyin.');
      return;
    }
    if (!username.trim() || !email.trim() || !password) {
      setError('Kullanıcı adı, e-posta ve şifre girin');
      return;
    }
    if (password.length < 6) {
      setError('Şifre en az 6 karakter olmalı');
      return;
    }
    setLoading(true);
    try {
      await register({
        username: username.trim(),
        email: email.trim(),
        password,
        displayName: displayName.trim() || username.trim(),
      });
    } catch (e) {
      setError(friendlyAuthError(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
        <Text style={styles.logo}>Ruffs</Text>
        <Text style={styles.subtitle}>Yeni hesap oluştur</Text>

        {!isConfigured ? (
          <View style={styles.configBox}>
            <Text style={styles.configTitle}>Firebase bağlantısı gerekli</Text>
            <Text style={styles.configText}>
              `tiktok-clone/.env` dosyasına `EXPO_PUBLIC_FIREBASE_*` değerlerini ekleyip uygulamayı yeniden başlatın.
            </Text>
          </View>
        ) : null}

        <TextInput
          style={styles.input}
          placeholder="Görünen ad"
          placeholderTextColor="rgba(255,255,255,0.4)"
          value={displayName}
          onChangeText={setDisplayName}
        />
        <TextInput
          style={styles.input}
          placeholder="Kullanıcı adı"
          placeholderTextColor="rgba(255,255,255,0.4)"
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TextInput
          style={styles.input}
          placeholder="E-posta"
          placeholderTextColor="rgba(255,255,255,0.4)"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          autoCorrect={false}
        />
        <TextInput
          style={styles.input}
          placeholder="Şifre (en az 6 karakter)"
          placeholderTextColor="rgba(255,255,255,0.4)"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <GlowWrap radius={12} style={{ marginTop: 14 }}>
          <TouchableOpacity style={[styles.button, { marginTop: 0 }]} onPress={onSubmit} disabled={loading}>
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Kaydol</Text>
            )}
          </TouchableOpacity>
        </GlowWrap>

        <TouchableOpacity onPress={() => navigation.navigate('Login')} style={styles.linkBtn}>
          <Text style={styles.linkText}>
            Zaten hesabın var mı? <Text style={styles.linkAccent}>Giriş yap</Text>
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  inner: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingVertical: 40,
  },
  logo: {
    color: '#fff',
    fontSize: 34,
    fontWeight: '800',
    textAlign: 'center',
  },
  subtitle: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 15,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 28,
  },
  configBox: {
    backgroundColor: 'rgba(254,44,85,0.12)',
    borderColor: 'rgba(254,44,85,0.35)',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
  },
  configTitle: {
    color: '#fff',
    fontWeight: '700',
    marginBottom: 4,
    fontSize: 14,
  },
  configText: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 13,
    lineHeight: 18,
  },
  input: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 13,
    color: '#fff',
    fontSize: 15,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  button: {
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  error: {
    color: '#FF6B6B',
    fontSize: 13,
    marginBottom: 4,
    textAlign: 'center',
  },
  linkBtn: {
    marginTop: 18,
    alignItems: 'center',
  },
  linkText: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 14,
  },
  linkAccent: {
    color: '#fff',
    fontWeight: '700',
  },
});

export default RegisterScreen;
