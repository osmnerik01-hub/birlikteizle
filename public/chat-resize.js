export function constrainChatSize(size, { gridWidth, gap = 24, viewportHeight, top = 20, mobile = false }) {
  const maxWidth = Math.max(270, Math.min(520, gridWidth - gap - 320));
  const maxHeight = Math.max(220, viewportHeight - (mobile ? 32 : Math.max(20, top) + 20));
  return {
    width: mobile ? gridWidth : Math.round(Math.max(270, Math.min(maxWidth, Number(size.width) || 310))),
    height: Math.round(Math.max(Math.min(300, maxHeight), Math.min(maxHeight, Number(size.height) || 520)))
  };
}
export function setupChatResize() {
  const grid = document.querySelector('.room-grid'), card = document.querySelector('.chat-card');
  const handle = document.querySelector('#chat-resize'), reset = document.querySelector('#chat-size-reset');
  if (!grid || !card || !handle || !reset) return;
  const key = 'bi-chat-size';
  let preferred, drag;
  try { const value = JSON.parse(localStorage.getItem(key) || 'null'); if (value && Number.isFinite(value.width) && Number.isFinite(value.height)) preferred = value; } catch {}
  const mobile = () => matchMedia('(max-width:760px)').matches;
  const bounds = () => ({ gridWidth: grid.clientWidth, gap: parseFloat(getComputedStyle(grid).columnGap) || 24, viewportHeight: window.visualViewport?.height || innerHeight, top: card.getBoundingClientRect().top, mobile: mobile() });
  function apply(size) {
    const result = constrainChatSize(size, bounds());
    grid.style.setProperty('--chat-width', `${result.width}px`);
    card.style.setProperty('--chat-height', `${result.height}px`);
    reset.hidden = false;
    return result;
  }
  function save(size) {
    preferred = size;
    try { localStorage.setItem(key, JSON.stringify(size)); } catch {}
  }
  if (preferred) apply(preferred);
  handle.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0) return;
    const rect = card.getBoundingClientRect();
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, width: rect.width, height: rect.height };
    handle.setPointerCapture(event.pointerId);
    card.classList.add('resizing');
    event.preventDefault();
  });
  handle.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return;
    apply({ width: drag.width + drag.x - event.clientX, height: drag.height + event.clientY - drag.y });
  });
  function finish(event) {
    if (!drag || drag.id !== event.pointerId) return;
    const rect = card.getBoundingClientRect();
    save({ width: mobile() ? preferred?.width || 310 : rect.width, height: rect.height });
    drag = null; card.classList.remove('resizing');
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
  }
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) handle.addEventListener(type, finish);
  handle.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const rect = card.getBoundingClientRect(), step = event.shiftKey ? 40 : 16;
    const size = apply({ width: rect.width + (event.key === 'ArrowLeft' ? step : event.key === 'ArrowRight' ? -step : 0), height: rect.height + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0) });
    save({ ...size, width: mobile() ? preferred?.width || 310 : size.width });
  });
  function restore() {
    preferred = null; grid.style.removeProperty('--chat-width'); card.style.removeProperty('--chat-height'); reset.hidden = true;
    try { localStorage.removeItem(key); } catch {}
  }
  reset.addEventListener('click', restore); handle.addEventListener('dblclick', restore);
  const reflow = () => { if (preferred && !drag) apply(preferred); };
  window.addEventListener('resize', reflow);
  window.visualViewport?.addEventListener('resize', reflow);
}
