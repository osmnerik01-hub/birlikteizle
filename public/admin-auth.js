export function authErrorMessage(error) {
  const code = String(error?.code || '').toLowerCase();
  if (code === 'auth/operation-not-allowed') return 'Firebase Authentication ayarlarında Google girişini etkinleştir.';
  if (code === 'auth/unauthorized-domain') return 'Bu siteyi Firebase Authentication yetkili alan adlarına ekle.';
  if (code === 'auth/popup-blocked') return 'Tarayıcı Google giriş penceresini engelledi. Bu site için açılır pencereye izin verip tekrar dene.';
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return 'Google girişi tamamlanmadı. Giriş düğmesine yeniden basıp hesabını seç.';
  if (code.includes('network') || code.includes('unavailable')) return 'Google veya Firebase bağlantısı kurulamadı. Bağlantını kontrol edip tekrar dene.';
  return error?.message || 'Google girişi tamamlanamadı. Yeniden dene.';
}

export async function withAuthTimeout(operation, milliseconds, message) {
  let timer;
  try {
    return await Promise.race([operation, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error(message), { code: 'admin/timeout' })), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

// Do not turn a stalled connection into a false "not an administrator" result.
export async function checkAdminAccess(readConfig, timeout = 12000) {
  try {
    await withAuthTimeout(readConfig(), timeout, 'Google oturumu açık ancak yönetici yetkisi Firebase üzerinden doğrulanamadı. Bağlantını kontrol edip tekrar dene.');
    return true;
  } catch (error) {
    if (/permission[-_]denied/i.test(String(error?.code || ''))) return false;
    throw error;
  }
}
