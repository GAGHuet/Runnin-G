export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];

export function haversine(a, b) {
  const R = 6371000, toR = x => x * Math.PI / 180;
  const dLat = toR(b.lat - a.lat), dLon = toR(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function fmtTime(sec, alwaysH = false) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  const p = n => String(n).padStart(2, '0');
  return (h || alwaysH) ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}
// ritmo en s/km -> "5:32"
export function fmtPace(secPerKm) {
  if (!isFinite(secPerKm) || secPerKm <= 0 || secPerKm > 3600) return '--:--';
  const m = Math.floor(secPerKm / 60), s = Math.round(secPerKm % 60);
  return s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, '0')}`;
}
export const fmtKm = m => (m / 1000).toFixed(2);

// Texto hablado para tiempos/ritmos
export function sayTime(sec) {
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  const parts = [];
  if (h) parts.push(`${h} ${h === 1 ? 'hora' : 'horas'}`);
  if (m) parts.push(`${m} ${m === 1 ? 'minuto' : 'minutos'}`);
  if (s && !h) parts.push(`${s} ${s === 1 ? 'segundo' : 'segundos'}`);
  return parts.join(' ') || '0 segundos';
}
export function sayPace(secPerKm) {
  if (!isFinite(secPerKm) || secPerKm <= 0) return 'sin dato';
  const m = Math.floor(secPerKm / 60), s = Math.round(secPerKm % 60);
  return `${m} ${m === 1 ? 'minuto' : 'minutos'}${s ? ` ${s}` : ''} por kilómetro`;
}

export const DAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
export function dayIdx(d = new Date()) { return (d.getDay() + 6) % 7; } // 0 = lunes
export function startOfWeek(d = new Date()) {
  const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - dayIdx(x)); return x;
}
export function isoDay(d) { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; }
export function fmtDate(ts) {
  return new Date(ts).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
}
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const pick = arr => arr[Math.floor(Math.random() * arr.length)];
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), ms);
}
export function download(name, text, type = 'application/octet-stream') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

// Miniatura SVG de una ruta
export function routeSvg(points, color = 'url(#rg)') {
  if (!points || points.length < 2) return '<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="6" fill="#2f3d63"/></svg>';
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const pts = points.map(p => {
    const x = p.lon * Math.cos(p.lat * Math.PI / 180), y = -p.lat;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    return [x, y];
  });
  const span = Math.max(maxX - minX, maxY - minY) || 1, pad = 8, sz = 64 - pad * 2;
  const ox = (sz - (maxX - minX) / span * sz) / 2, oy = (sz - (maxY - minY) / span * sz) / 2;
  const step = Math.max(1, Math.floor(pts.length / 150));
  const d = pts.filter((_, i) => i % step === 0 || i === pts.length - 1)
    .map(([x, y], i) => `${i ? 'L' : 'M'}${(pad + ox + (x - minX) / span * sz).toFixed(1)} ${(pad + oy + (y - minY) / span * sz).toFixed(1)}`).join('');
  return `<svg viewBox="0 0 64 64"><defs><linearGradient id="rg" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#ff3d7f"/><stop offset="1" stop-color="#c6ff3d"/></linearGradient></defs><path d="${d}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
