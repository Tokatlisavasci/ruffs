// Render'da `playwright install` varsayılan olarak ~/.cache/ms-playwright içine kuruyor;
// bu dizin build'den çalışma zamanına taşınmadığı için her deploy'da Chromium kayboluyor.
// PLAYWRIGHT_BROWSERS_PATH=0 ile tarayıcı node_modules içine kurulur ve deploy ile birlikte gelir.
const { execFileSync } = require('child_process');

const env = { ...process.env };
if (process.env.RENDER) env.PLAYWRIGHT_BROWSERS_PATH = '0';

try {
  execFileSync('npx', ['playwright', 'install', 'chromium'], {
    stdio: 'inherit',
    env,
    shell: process.platform === 'win32',
  });
} catch (e) {
  // Build'i düşürme: sunucu açılışta yeniden deniyor.
  console.warn('Chromium kurulumu başarısız, çalışma zamanında tekrar denenecek:', e?.message || e);
}
