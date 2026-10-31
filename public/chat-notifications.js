// First snapshot is history; only unseen incoming messages can notify.
export function createIncomingTracker() {
  let initialized = false, seen = new Set(), newest = 0;
  return (messages, ownId) => {
    const incoming = initialized && messages.some(message => !seen.has(message.id) && message.memberId !== ownId && Number(message.at) >= newest);
    initialized = true;
    seen = new Set(messages.map(message => message.id));
    newest = Math.max(newest, ...messages.map(message => Number(message.at) || 0));
    return incoming;
  };
}
export function createChatSound({ AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext, now = () => Date.now() } = {}) {
  let context, lastPlayed = -Infinity;
  return {
    unlock() {
      try {
        context ||= AudioContext ? new AudioContext() : null;
        if (context?.state === 'suspended') Promise.resolve(context.resume()).catch(() => {});
      } catch {}
    },
    play() {
      if (!context || context.state !== 'running' || now() - lastPlayed < 700) return;
      try {
        const start = context.currentTime;
        const gain = context.createGain(), tone = context.createOscillator();
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.07, start + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.22);
        tone.type = 'sine'; tone.frequency.setValueAtTime(880, start);
        tone.frequency.setValueAtTime(1174.66, start + 0.09);
        tone.connect(gain); gain.connect(context.destination);
        tone.onended = () => { tone.disconnect(); gain.disconnect(); };
        tone.start(start); tone.stop(start + 0.24);
        lastPlayed = now();
      } catch {}
    }
  };
}
