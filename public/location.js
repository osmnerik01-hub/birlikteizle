// Approximate network location only; never persist IP addresses or coordinates.
export function normalizeLocation(data) {
  if (data?.success !== true) return null;
  const clean = value => typeof value === 'string' ? value.trim().slice(0, 80) : '';
  const region = clean(data.region), country = clean(data.country_code);
  if (!region || !/^[A-Z]{2}$/.test(country)) return null;
  return { region, country };
}
let pending;
export function approximateLocation() {
  if (pending) return pending;
  pending = (async () => {
    try {
      const cached = JSON.parse(sessionStorage.getItem('bi-network-location') || 'null');
      if (cached && Date.now() - cached.at < 3600000) return normalizeLocation({ success: true, ...cached.value, country_code: cached.value.country });
    } catch {}
    try {
      const response = await fetch('https://ipwho.is/?fields=success,region,country_code', { credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(5000) });
      if (!response.ok) return null;
      const value = normalizeLocation(await response.json());
      if (value) { try { sessionStorage.setItem('bi-network-location', JSON.stringify({ at: Date.now(), value })); } catch {} }
      return value;
    } catch { return null; }
  })();
  return pending;
}
