import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  updateProfile,
} from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db, isFirebaseConfigured } from '../config/firebase';
import { uploadCloudinaryAsset } from '../services/videos';

const AuthContext = createContext(null);

function profileFromFirebase(user, data = {}) {
  return {
    id: user.uid,
    email: user.email || '',
    username: data.username || (user.email ? user.email.split('@')[0] : 'kullanici'),
    displayName: data.displayName || user.displayName || data.username || 'Kullanıcı',
    bio: data.bio || '',
    avatar: data.avatar || user.photoURL || null,
    followers: data.followers || 0,
    following: data.following || 0,
    likes: data.likes || 0,
  };
}

async function loadProfile(fbUser) {
  try {
    const ref = doc(db, 'users', fbUser.uid);
    const snap = await getDoc(ref);
    return profileFromFirebase(fbUser, snap.exists() ? snap.data() : {});
  } catch (e) {
    // Firestore henüz oluşturulmamış / kural hatası vb. durumlarda auth akışını bozma.
    console.warn('Profil yüklenemedi, yerel profil kullanılacak:', e?.code || e?.message || e);
    return profileFromFirebase(fbUser, {});
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setInitializing(false);
      return;
    }
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      try {
        if (!fbUser) {
          setUser(null);
        } else {
          setUser(await loadProfile(fbUser));
        }
      } catch (e) {
        if (fbUser) setUser(profileFromFirebase(fbUser, {}));
        else setUser(null);
      } finally {
        setInitializing(false);
      }
    });
    return unsub;
  }, []);

  const login = useCallback(async ({ email, password }) => {
    if (!isFirebaseConfigured) throw new Error('Firebase yapılandırılmadı (.env)');
    const cred = await signInWithEmailAndPassword(auth, String(email).trim(), String(password));
    const profile = await loadProfile(cred.user);
    setUser(profile);
    return profile;
  }, []);

  const register = useCallback(async ({ username, email, password, displayName }) => {
    if (!isFirebaseConfigured) throw new Error('Firebase yapılandırılmadı (.env)');
    const uname = String(username || '').trim().toLowerCase().replace(/\s+/g, '_');
    const mail = String(email).trim();
    const dname = String(displayName || username || 'Kullanıcı').trim();
    const cred = await createUserWithEmailAndPassword(auth, mail, String(password));
    try {
      await updateProfile(cred.user, { displayName: dname });
    } catch {}
    const data = {
      username: uname || mail.split('@')[0],
      displayName: dname,
      email: mail.toLowerCase(),
      bio: '',
      avatar: null,
      followers: 0,
      following: 0,
      likes: 0,
      createdAt: serverTimestamp(),
    };
    try {
      await setDoc(doc(db, 'users', cred.user.uid), data, { merge: true });
    } catch (e) {
      // Auth hesabı oluştu; Firestore kurulumu eksikse profili yine de yerelde göster.
      console.warn('Profil Firestore\'a yazılamadı (veritabanı kurulumu kontrol edin):', e?.code || e?.message || e);
    }
    const profile = profileFromFirebase(cred.user, data);
    setUser(profile);
    return profile;
  }, []);

  const logout = useCallback(async () => {
    if (!isFirebaseConfigured) {
      setUser(null);
      return;
    }
    await signOut(auth);
    setUser(null);
  }, []);

  const refreshUser = useCallback(async () => {
    if (!isFirebaseConfigured || !auth.currentUser) return null;
    const profile = await loadProfile(auth.currentUser);
    setUser(profile);
    return profile;
  }, []);

  const updateUserProfile = useCallback(async ({ displayName, username, bio, avatarUri, avatarMimeType } = {}) => {
    if (!isFirebaseConfigured || !auth.currentUser) throw new Error('Oturum gerekli');
    const uid = auth.currentUser.uid;
    const updates = {};
    if (displayName != null) updates.displayName = String(displayName).trim();
    if (username != null) updates.username = String(username).trim().toLowerCase().replace(/\s+/g, '_').replace(/^@/, '');
    if (bio != null) updates.bio = String(bio).trim().slice(0, 150);
    if (avatarUri) {
      const up = await uploadCloudinaryAsset({ uri: avatarUri, userId: uid, mediaType: 'image', mimeType: avatarMimeType || 'image/jpeg' });
      updates.avatar = up.url;
    }
    const fbUpdates = {};
    if (updates.displayName) fbUpdates.displayName = updates.displayName;
    if (updates.avatar) fbUpdates.photoURL = updates.avatar;
    if (Object.keys(fbUpdates).length) {
      try { await updateProfile(auth.currentUser, fbUpdates); } catch (e) { console.warn('auth profile update:', e?.message || e); }
    }
    if (db && Object.keys(updates).length) {
      await setDoc(doc(db, 'users', uid), updates, { merge: true });
    }
    const profile = await loadProfile(auth.currentUser);
    setUser(profile);
    return profile;
  }, []);

  const value = useMemo(
    () => ({ user, initializing, login, register, logout, refreshUser, updateUserProfile, isConfigured: isFirebaseConfigured }),
    [user, initializing, login, register, logout, refreshUser, updateUserProfile]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth AuthProvider içinde kullanılmalı');
  return ctx;
}
