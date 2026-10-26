// A position is a sample taken at a time, not a fixed seek target.
export function playbackAt(clock, now = Date.now()) {
  const elapsed = Math.max(0, (now - clock.receivedAt) / 1000);
  const expired = elapsed > 12;
  return { time: Math.min(604800, clock.time + (clock.playing ? Math.min(elapsed, 12) : 0)), playing: clock.playing && !expired };
}

export function correctionFor(state, clock, now = Date.now()) {
  if (!state?.ready || !clock) return null;
  const target = playbackAt(clock, now);
  if (state.duration > 0) target.time = Math.min(target.time, state.duration);
  // Let the source finish loading/seeking. A pause must still be applied immediately.
  if (target.playing && (state.buffering || state.seeking)) return null;
  if (Math.abs(state.time - target.time) <= 1.25 && state.playing === target.playing) return null;
  return { action: 'playback', ...target };
}
