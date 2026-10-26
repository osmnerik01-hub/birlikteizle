const loadedVersion = document.querySelector('script[data-app-build]')?.dataset.appBuild;
const draftKey = `bi-update-draft:${location.pathname}`;
try {
  const draft = sessionStorage.getItem(draftKey), input = document.querySelector('#message');
  if (draft && input && !input.value) { input.value = draft; sessionStorage.removeItem(draftKey); }
} catch { /* Storage may be unavailable in a restricted browser. */ }

let checking = false, announced = false;
async function checkForUpdate() {
  if (!loadedVersion || document.hidden || checking || announced) return;
  checking = true;
  try {
    const response = await fetch('/build-info.json', { cache: 'no-store' });
    if (!response.ok) return;
    const { version } = await response.json();
    if (!/^[a-f0-9]{16}$/.test(version) || version === loadedVersion) return;
    announced = true;
    const notice = document.createElement('aside'); notice.className = 'update-banner'; notice.setAttribute('role', 'status');
    const text = document.createElement('span'); text.textContent = 'Yeni sürüm hazır.';
    const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Yenile';
    button.onclick = () => {
      if (!window.dispatchEvent(new Event('app-before-update', { cancelable: true }))) return;
      try { const input = document.querySelector('#message'); if (input?.value) sessionStorage.setItem(draftKey, input.value); } catch { /* Keep refresh available. */ }
      location.reload();
    };
    notice.append(text, button); document.body.append(notice);
  } catch { /* Offline checks must not interrupt playback or chat. */ }
  finally { checking = false; }
}
if (loadedVersion) {
  setInterval(checkForUpdate, 60000);
  document.addEventListener('visibilitychange', checkForUpdate);
  window.addEventListener('pageshow', checkForUpdate);
  checkForUpdate();
}
