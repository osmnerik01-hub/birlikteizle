import { isAppUrl, sourceUrl, cleanState, cleanCommand } from './protocol.js';
import { correctionFor } from './playback.js';

let work = Promise.resolve();
const readBindings = async () => (await chrome.storage.session.get('bindings')).bindings || {};
async function saveBinding(tabId, binding, allowCreate = false, replaceClock = false) {
  work = work.catch(() => {}).then(async () => {
    const bindings = await readBindings(), previous = bindings[tabId];
    if (binding) {
      if (!previous && !allowCreate) return;
      if (previous && (previous.url !== binding.url || previous.appTabId !== binding.appTabId) && !allowCreate) return;
      const current = previous?.current && binding.current && previous.current.receivedAt > binding.current.receivedAt ? previous.current : binding.current;
      bindings[tabId] = { ...binding, current, clock: replaceClock ? binding.clock : previous?.clock || null, canControl: replaceClock ? binding.canControl === true : previous?.canControl === true };
    } else delete bindings[tabId];
    await chrome.storage.session.set({ bindings });
  });
  return work;
}
async function tellApp(binding, event, data) { try { await chrome.tabs.sendMessage(binding.appTabId, { source: 'birlikte-extension', event, data }); } catch { /* Closed room tab. */ } }
const corrections = new Map();
async function reconcile(tabId, force = false) {
  const binding = (await readBindings())[tabId];
  const command = correctionFor(binding?.current, binding?.clock);
  const last = corrections.get(tabId);
  if (!command || last?.pending || !force && Date.now() - (last?.at || 0) < (last?.failed ? 3000 : 800)) return;
  const attempt = { pending: true, at: Date.now(), failed: false }; corrections.set(tabId, attempt);
  try {
    const result = await chrome.tabs.sendMessage(Number(tabId), { source: 'birlikte-extension', action: 'COMMAND', playerId: binding.current.playerId, command }, { frameId: binding.current.frameId });
    if (!result?.ok) throw new Error(result?.error || 'Kaynak pencerede videoyu bir kez başlat.');
  } catch (error) { attempt.failed = true; await tellApp(binding, 'SOURCE_ERROR', { pageUrl: binding.url, error: error.message }); }
  finally { attempt.pending = false; }
}
const broadOrigins = ['https://*/*', 'http://*/*'];
async function ready() { return chrome.permissions.contains({ origins: broadOrigins }); }
async function registerDetector() {
  if (!await ready()) return;
  const scripts = await chrome.scripting.getRegisteredContentScripts({ ids: ['source-detector', 'source-provider'] });
  const configs = [
    { id: 'source-detector', matches: broadOrigins, js: ['source.js'], allFrames: true, matchOriginAsFallback: true, runAt: 'document_start', persistAcrossSessions: true },
    { id: 'source-provider', matches: broadOrigins, js: ['source-provider.js'], world: 'MAIN', allFrames: true, matchOriginAsFallback: true, runAt: 'document_start', persistAcrossSessions: true }
  ].filter(config => !scripts.some(script => script.id === config.id));
  if (configs.length) await chrome.scripting.registerContentScripts(configs);
}

export async function handleMessage(message, sender) {
  if (message?.source === 'birlikte-app' && sender.tab && sender.frameId === 0 && isAppUrl(sender.url)) {
    if (message.action === 'PING') return { installed: true, ready: await ready(), version: chrome.runtime.getManifest().version };
    const bindings = await readBindings();
    const existing = Object.entries(bindings).find(([, b]) => b.appTabId === sender.tab.id);
    if (message.action === 'OPEN_SOURCE') {
      if (!await ready()) throw new Error('Eklenti simgesinden video sayfalarına erişimi etkinleştir.');
      await registerDetector();
      const url = sourceUrl(message.url);
      if (existing && existing[1].url === url) {
        try {
          await chrome.tabs.update(Number(existing[0]), { active: true });
          await chrome.windows.update(existing[1].windowId, { focused: true });
          return { opened: true, state: existing[1].current ? { ...existing[1].current, pageUrl: url } : null };
        } catch { await saveBinding(existing[0], null); }
      }
      if (existing) {
        try { await chrome.tabs.sendMessage(Number(existing[0]), { source: 'birlikte-extension', action: 'STOP' }); } catch {}
        await saveBinding(existing[0], null);
      }
      // Register before navigating, so document_start sees its binding.
      const popup = await chrome.windows.create({ url: 'about:blank', type: 'popup', width: 1100, height: 760, focused: true });
      const tab = popup?.tabs?.[0];
      if (!tab?.id) throw new Error('Kaynak penceresi açılamadı. Yeniden dene.');
      await saveBinding(tab.id, { appTabId: sender.tab.id, appWindowId: sender.tab.windowId, windowId: popup.id, url, current: null, clock: null }, true);
      try { await chrome.tabs.update(tab.id, { url }); }
      catch (error) { await saveBinding(tab.id, null); await chrome.windows.remove(popup.id).catch(() => {}); throw error; }
      return { opened: true };
    }
    if (message.action === 'FULLSCREEN_SOURCE') {
      if (!existing) throw new Error('Önce kaynak penceresini aç.');
      const window = await chrome.windows.get(existing[1].windowId);
      await chrome.windows.update(window.id, { focused: true, state: window.state === 'fullscreen' ? 'normal' : 'fullscreen' });
      return { ok: true };
    }
    if (message.action === 'CLOSE_SOURCE') { if (existing) { try { await chrome.tabs.sendMessage(Number(existing[0]), { source: 'birlikte-extension', action: 'STOP' }); } catch {} await saveBinding(existing[0], null); } return { stopped: true }; }
    if (message.action === 'GET_STATE') return { state: existing?.[1].current || null };
    if (message.action === 'SYNC_PLAYBACK') {
      if (!existing || existing[1].url !== sourceUrl(message.url)) return { watching: false };
      const command = cleanCommand({ ...message.playback, action: 'playback' });
      existing[1].clock = message.controller === true ? null : { time: command.time, playing: command.playing, receivedAt: Date.now() };
      existing[1].canControl = message.canControl === true;
      await saveBinding(existing[0], existing[1], false, true);
      await reconcile(existing[0], true);
      return { watching: true };
    }
    if (message.action === 'COMMAND') {
      if (!existing?.[1].current) throw new Error('Kaynak pencerede önce videoyu oynat.');
      const command = cleanCommand(message.command);
      const result = await chrome.tabs.sendMessage(Number(existing[0]), { source: 'birlikte-extension', action: 'COMMAND', playerId: existing[1].current.playerId, command }, { frameId: existing[1].current.frameId });
      if (!result?.ok) throw new Error(result?.error || 'Kaynak oynatıcı komutu uygulayamadı.');
      return result;
    }
    throw new Error('Bilinmeyen oda komutu.');
  }
  if (message?.source === 'birlikte-source' && sender.tab) {
    const bindings = await readBindings(), binding = bindings[sender.tab.id];
    if (!binding) return { watching: false };
    if (message.action === 'HELLO') return { watching: true };
    if (message.action === 'FOCUS_ROOM') {
      await chrome.tabs.update(binding.appTabId, { active: true });
      if (binding.appWindowId !== undefined) await chrome.windows.update(binding.appWindowId, { focused: true });
      return { ok: true };
    }
    if (message.action === 'STATE') {
      const now = Date.now();
      const sampledAt = Number.isFinite(message.state?.sampledAt) ? Math.max(now - 3000, Math.min(now, message.state.sampledAt)) : now;
      const state = { ...cleanState(message.state), frameId: sender.frameId, receivedAt: sampledAt };
      if (!state.playerId || state.area < 100) return { ok: false };
      const previous = binding.current;
      const same = previous?.playerId === state.playerId && previous?.frameId === state.frameId;
      const preferred = !previous || Date.now() - previous.receivedAt > 5000 || state.playing && !previous.playing && state.area >= previous.area * .5 || !previous.playing && state.area > previous.area || state.playing && state.area > previous.area * 1.5;
      if (same || preferred) {
        const manualControl = state.userAction && binding.canControl;
        if (manualControl) binding.clock = null;
        binding.current = state; await saveBinding(sender.tab.id, binding, false, manualControl);
        await tellApp(binding, 'SOURCE_STATE', { ...state, pageUrl: binding.url });
        await reconcile(sender.tab.id);
      }
      return { ok: true };
    }
  }
  if (message?.source === 'birlikte-popup' && !sender.tab && sender.url?.startsWith(chrome.runtime.getURL(''))) {
    if (message.action === 'ACTIVATE') { await registerDetector(); return { ready: await ready() }; }
    if (message.action === 'STATUS') { const bindings = await readBindings(); return { ready: await ready(), count: Object.keys(bindings).length }; }
    if (message.action === 'STOP_ALL') {
      for (const [tabId, binding] of Object.entries(await readBindings())) {
        try { await chrome.tabs.sendMessage(Number(tabId), { source: 'birlikte-extension', action: 'STOP' }); } catch {}
        await tellApp(binding, 'SOURCE_CLOSED', { pageUrl: binding.url });
      }
      await chrome.storage.session.set({ bindings: {} }); return { ok: true };
    }
  }
  throw new Error('Bu sayfaya erişim izni yok.');
}

chrome.runtime.onMessage.addListener((message, sender, respond) => { handleMessage(message, sender).then(result => respond({ ok: true, ...result }), error => respond({ ok: false, error: error.message })); return true; });
chrome.runtime.onInstalled.addListener(() => { registerDetector().catch(() => {}); });
chrome.runtime.onStartup.addListener(() => { registerDetector().catch(() => {}); });
chrome.tabs.onRemoved.addListener(async tabId => {
  corrections.delete(String(tabId));
  const bindings = await readBindings();
  if (bindings[tabId]) { await tellApp(bindings[tabId], 'SOURCE_CLOSED', { pageUrl: bindings[tabId].url }); await saveBinding(tabId, null); }
  for (const [sourceId, binding] of Object.entries(bindings)) if (binding.appTabId === tabId) { try { await chrome.tabs.sendMessage(Number(sourceId), { source: 'birlikte-extension', action: 'STOP' }); } catch {} await saveBinding(sourceId, null); }
});
chrome.tabs.onUpdated.addListener(async (tabId, change) => { if (change.status !== 'loading') return; const binding = (await readBindings())[tabId]; if (binding) { binding.current = null; await saveBinding(tabId, binding); } });
chrome.permissions.onRemoved.addListener(async () => {
  if (await ready()) return;
  for (const [tabId, binding] of Object.entries(await readBindings())) {
    try { await chrome.tabs.sendMessage(Number(tabId), { source: 'birlikte-extension', action: 'STOP' }); } catch {}
    await tellApp(binding, 'SOURCE_CLOSED', { pageUrl: binding.url });
  }
  await chrome.storage.session.set({ bindings: {} });
  await chrome.scripting.unregisterContentScripts({ ids: ['source-detector', 'source-provider'] }).catch(() => {});
});
