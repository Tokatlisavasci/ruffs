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
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useAuth } from '../context/AuthContext';
import GlowWrap from '../components/GlowWrap';

function friendlyAuthError(e) {
  const code = e?.code || '';
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) {
    return 'E-posta veya şifre hatalı';
  }
  if (code.includes('invalid-email')) return 'Geçerli bir e-posta girin';
  if (code.includes('too-many-requests')) return 'Çok fazla deneme. Biraz sonra tekrar deneyin';
  if (code.includes('network')) return 'Ağ hatası. Bağlantınızı kontrol edin';
  return e?.message || 'Giriş yapılamadı';
}

const LoginScreen = ({ navigation }) => {
  const { login, isConfigured } = useAuth();
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
    if (!email.trim() || !password) {
      setError('E-posta ve şifre girin');
      return;
    }
    setLoading(true);
    try {
      await login({ email: email.trim(), password });
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
      <View style={styles.inner}>
        <Text style={styles.logo}>Ruffs</Text>
        <Text style={styles.subtitle}>Hesabına giriş yap</Text>

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
          placeholder="Şifre"
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
              <Text style={styles.buttonText}>Giriş yap</Text>
            )}
          </TouchableOpacity>
        </GlowWrap>

        <TouchableOpacity onPress={() => navigation.navigate('Register')} style={styles.linkBtn}>
          <Text style={styles.linkText}>
            Hesabın yok mu? <Text style={styles.linkAccent}>Kaydol</Text>
          </Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  inner: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
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

export default LoginScreen;
