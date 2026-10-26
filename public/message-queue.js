// Keep writes ordered without rejecting ordinary short bursts of chat messages.
export function createMessageQueue(send, { interval = 650, maxPending = 20, now = Date.now, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  let tail = Promise.resolve(), pending = 0, lastStarted = -Infinity;
  const enqueue = text => {
    if (pending >= maxPending) return Promise.reject(new Error('Mesajlar sırayla gönderiliyor. Kısa bir süre bekle; yazdığın mesaj korunuyor.'));
    pending++;
    const result = tail.then(async () => {
      const delay = interval - (now() - lastStarted);
      if (delay > 0) await wait(delay);
      lastStarted = now();
      return send(text);
    });
    tail = result.catch(() => {}).finally(() => { pending--; });
    return result;
  };
  Object.defineProperty(enqueue, 'pending', { get: () => pending });
  return enqueue;
}
