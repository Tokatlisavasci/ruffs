# Vercel imzalama API (güvenli)

Bu klasör, Cloudinary imzalı yükleme için public HTTPS endpoint sağlar: `POST /api/uploads/sign`.
- **Güvenlik:** `Authorization: Bearer <Firebase ID token>` doğrulanır; `uid` tokendan alınır. `CLOUDINARY_API_SECRET` asla uygulamaya konmaz.
- Vercel’e deploy ederken **Environment Variables** ekleyin:
  - `CLOUDINARY_CLOUD_NAME`
  - `CLOUDINARY_API_KEY`
  - `CLOUDINARY_API_SECRET` (secret)
  - `CLOUDINARY_FOLDER` = `ruffs`
  - `FIREBASE_SERVICE_ACCOUNT` = Firebase service account JSON’unun **tam içeriği** (tek satır/string; secret). (Firebase Console → Project settings → Service accounts → Generate new private key)
- Uygulamada: `EXPO_PUBLIC_SIGNING_API_URL=https://<vercel-projen>.vercel.app` (istemci `/api/uploads/sign` yolunu kullanır — bkz. `src/api/config.js` notu gerekirse; bu endpoint `/api/uploads/sign` altında).
