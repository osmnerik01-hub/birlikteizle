(() => {
  const origins = ['https://your-firebase-project.web.app', 'https://your-firebase-project.firebaseapp.com', 'http://localhost:3000', 'http://127.0.0.1:3000'];
  if (!origins.includes(location.origin) || window !== top) return;
  let disconnected = false;
  window.addEventListener('message', async event => {
    const data = event.data;
    if (event.source !== window || event.origin !== location.origin || data?.source !== 'birlikte-app' || typeof data.requestId !== 'string' || data.requestId.length > 80) return;
    if (!['PING', 'OPEN_SOURCE', 'CLOSE_SOURCE', 'COMMAND', 'GET_STATE', 'SYNC_PLAYBACK', 'FULLSCREEN_SOURCE'].includes(data.action)) return;
    let result;
    try {
      if (disconnected || !chrome.runtime?.id) {
        disconnected = true;
        result = { ok: false, error: 'Eklenti yenilendi. Oda ve kaynak sayfalarini yenile.' };
      } else result = await chrome.runtime.sendMessage(data);
    } catch (error) {
      if (/context invalidated/i.test(error?.message || '')) disconnected = true;
      result = { ok: false, error: 'Eklenti ba\u011flant\u0131s\u0131 kesildi. Oda ve kaynak sayfalar\u0131n\u0131 yenile.' };
    }
    window.postMessage({ source: 'birlikte-extension', requestId: data.requestId, result }, location.origin);
  });
  chrome.runtime.onMessage.addListener(message => { if (message?.source === 'birlikte-extension' && ['SOURCE_STATE', 'SOURCE_CLOSED', 'SOURCE_ERROR'].includes(message.event)) window.postMessage(message, location.origin); });
})();
