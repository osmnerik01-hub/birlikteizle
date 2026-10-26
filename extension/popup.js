const status = document.querySelector('#status');
async function refresh() { const result = await chrome.runtime.sendMessage({ source: 'birlikte-popup', action: 'STATUS' }); status.textContent = result.ready ? `Erişim açık · ${result.count} kaynak sekme bağlı` : 'Video algılama için site erişimini etkinleştir.'; document.querySelector('#enable').hidden = result.ready; }
document.querySelector('#enable').onclick = async () => {
  try {
    const granted = await chrome.permissions.request({ origins: ['https://*/*', 'http://*/*'] });
    if (!granted) { status.textContent = 'Site erişimi verilmedi.'; return; }
    const result = await chrome.runtime.sendMessage({ source: 'birlikte-popup', action: 'ACTIVATE' });
    if (!result.ok) throw new Error(result.error);
    await refresh();
  } catch (error) { status.textContent = error.message; }
};
document.querySelector('#stop').onclick = async () => { await chrome.runtime.sendMessage({ source: 'birlikte-popup', action: 'STOP_ALL' }); await refresh(); };
refresh().catch(error => status.textContent = error.message);
