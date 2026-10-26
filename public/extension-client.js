export class ExtensionClient extends EventTarget {
  constructor() {
    super(); this.pending = new Map(); this.connected = false;
    window.addEventListener('message', event => {
      const message = event.data;
      if (event.source !== window || event.origin !== location.origin || message?.source !== 'birlikte-extension') return;
      if (message.requestId && this.pending.has(message.requestId)) {
        const pending = this.pending.get(message.requestId); clearTimeout(pending.timer); this.pending.delete(message.requestId);
        if (message.result?.ok) pending.resolve(message.result); else pending.reject(new Error(message.result?.error || 'Eklenti yanıt vermedi.'));
      } else if (['SOURCE_STATE', 'SOURCE_CLOSED', 'SOURCE_ERROR'].includes(message.event)) this.dispatchEvent(new CustomEvent(message.event, { detail: message.data }));
    });
  }
  request(action, input = {}) {
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(new Error('Chrome eklentisi bulunamadı. Eklentiyi kurup oda sayfasını yenile.')); }, 5000);
      this.pending.set(requestId, { resolve, reject, timer });
      window.postMessage({ source: 'birlikte-app', requestId, action, ...input }, location.origin);
    });
  }
  async ping() { const result = await this.request('PING'); this.connected = true; return result; }
  open(url) { return this.request('OPEN_SOURCE', { url }); }
  sync(url, playback, controller, canControl = false) { return this.request('SYNC_PLAYBACK', { url, playback, controller, canControl }); }
  fullscreen() { return this.request('FULLSCREEN_SOURCE'); }
  command(command) { return this.request('COMMAND', { command }); }
}
