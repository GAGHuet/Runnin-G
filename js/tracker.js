// Seguimiento GPS: filtra lecturas imprecisas, calcula distancia, ritmo, parciales por km
// y lleva el control de los bloques de la sesión planificada.
import { haversine } from './util.js';

export class Tracker {
  constructor({ workout, weightKg = 75, onUpdate, onKm, onSegment, onCountdown, onGps, simulate = false }) {
    Object.assign(this, { workout, weightKg, onUpdate, onKm, onSegment, onCountdown, onGps, simulate });
    this.points = []; this.splits = []; this.dist = 0; this.elapsed = 0;
    this.state = 'idle'; this.segIdx = -1; this.hr = null; this.hrSamples = [];
    this.lastKmDist = 0; this.lastKmTime = 0; this.elevGain = 0; this.accuracy = null;
  }

  async start() {
    this.state = 'running'; this.startTs = Date.now(); this.lastTick = performance.now();
    this.segIdx = -1; this.advanceSegment();
    this.timer = setInterval(() => this.tick(), 1000);
    this.lockScreen();
    if (this.simulate) this.startSim();
    else if ('geolocation' in navigator) {
      this.watch = navigator.geolocation.watchPosition(p => this.onPos(p), e => this.onGps?.({ error: e.message }),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
    } else this.onGps?.({ error: 'Este navegador no tiene GPS' });
  }
  pause() { if (this.state !== 'running') return; this.state = 'paused'; this.lastPt = null; }
  resume() { if (this.state !== 'paused') return; this.state = 'running'; this.lastTick = performance.now(); }
  stop() {
    this.state = 'stopped'; clearInterval(this.timer); clearInterval(this.simTimer);
    if (this.watch != null) navigator.geolocation.clearWatch(this.watch);
    try { this.wake?.release(); } catch {}
    document.removeEventListener('visibilitychange', this._vis);
    return this.summary();
  }

  async lockScreen() {
    try {
      if ('wakeLock' in navigator) {
        this.wake = await navigator.wakeLock.request('screen');
        this._vis = async () => { if (document.visibilityState === 'visible' && this.state !== 'stopped') try { this.wake = await navigator.wakeLock.request('screen'); } catch {} };
        document.addEventListener('visibilitychange', this._vis);
      }
    } catch {}
  }

  setHr(bpm) { this.hr = bpm; if (this.state === 'running') this.hrSamples.push(bpm); }

  onPos(p) {
    const { latitude: lat, longitude: lon, accuracy: acc, altitude: alt } = p.coords;
    this.accuracy = acc;
    this.onGps?.({ acc, lat, lon });
    if (this.state !== 'running') return;
    if (acc > 35) return; // demasiado impreciso
    const pt = { lat: +lat.toFixed(6), lon: +lon.toFixed(6), t: Date.now(), alt: alt != null ? Math.round(alt * 10) / 10 : null, hr: this.hr || undefined };
    if (this.lastPt) {
      const d = haversine(this.lastPt, pt), dt = (pt.t - this.lastPt.t) / 1000;
      if (d < Math.max(2, acc * 0.25)) return;        // ruido estando parado
      if (dt > 0 && d / dt > 12) return;              // >43 km/h: salto de GPS
      this.dist += d;
      if (pt.alt != null && this.lastPt.alt != null && pt.alt - this.lastPt.alt > 0.5) this.elevGain += pt.alt - this.lastPt.alt;
    }
    this.lastPt = pt; this.points.push(pt);
    this.checkKm();
  }

  checkKm() {
    while (this.dist - this.lastKmDist >= 1000) {
      // interpola el tiempo exacto del km
      const over = this.dist - this.lastKmDist - 1000;
      const lastLegSpeed = this.curSpeed() || (this.dist / Math.max(1, this.elapsed));
      const kmTime = this.elapsed - (lastLegSpeed > 0 ? over / lastLegSpeed : 0);
      const split = { km: this.splits.length + 1, sec: Math.round(kmTime - this.lastKmTime), at: Math.round(kmTime), hr: this.avgHrSince(this.lastKmTime) };
      this.splits.push(split);
      this.lastKmDist += 1000; this.lastKmTime = kmTime;
      this.onKm?.(split, this.stats());
    }
  }
  avgHrSince() { const s = this.hrSamples.splice(0); return s.length ? Math.round(s.reduce((a, b) => a + b, 0) / s.length) : undefined; }

  curSpeed() { // m/s en los últimos ~30 s
    const pts = this.points; if (pts.length < 2) return 0;
    const last = pts[pts.length - 1]; if (Date.now() - last.t > 15000) return 0;
    let d = 0, i = pts.length - 1;
    while (i > 0 && last.t - pts[i - 1].t <= 30000) { d += haversine(pts[i - 1], pts[i]); i--; }
    const dt = (last.t - pts[i].t) / 1000;
    return dt >= 8 ? d / dt : 0;
  }

  tick() {
    const now = performance.now();
    if (this.state === 'running') this.elapsed += (now - this.lastTick) / 1000;
    this.lastTick = now;
    if (this.state === 'running' && this.workout?.segments) {
      const seg = this.workout.segments[this.segIdx];
      if (seg) {
        const left = this.segEnd - this.elapsed;
        if (left <= 3.5 && left > 0.5 && Math.ceil(left) !== this._cd) { this._cd = Math.ceil(left); this.onCountdown?.(this._cd); }
        if (this.elapsed >= this.segEnd) this.advanceSegment();
      }
    }
    this.onUpdate?.(this.stats());
  }
  advanceSegment() {
    const segs = this.workout?.segments; if (!segs) return;
    this.segIdx++; this._cd = null;
    if (this.segIdx >= segs.length) { this.workoutDone = true; this.onSegment?.(null, this.segIdx, segs.length); return; }
    this.segStart = this.segIdx === 0 ? 0 : this.segEnd;
    this.segEnd = this.segStart + segs[this.segIdx].dur;
    this.onSegment?.(segs[this.segIdx], this.segIdx, segs.length);
  }

  stats() {
    const sp = this.curSpeed();
    const seg = this.workout?.segments?.[this.segIdx];
    return {
      state: this.state, elapsed: this.elapsed, dist: this.dist,
      avgPace: this.dist > 50 ? this.elapsed / (this.dist / 1000) : 0,
      curPace: sp > 0.5 ? 1000 / sp : 0,
      kmPace: this.dist - this.lastKmDist > 100 ? (this.elapsed - this.lastKmTime) / ((this.dist - this.lastKmDist) / 1000) : 0,
      lastSplit: this.splits[this.splits.length - 1], prevSplit: this.splits[this.splits.length - 2]?.sec,
      kcal: this.weightKg * (this.dist / 1000) * 1.03,
      hr: this.hr, elevGain: this.elevGain,
      seg, segIdx: this.segIdx, segType: seg?.type, segLeft: seg ? this.segEnd - this.elapsed : 0,
      nextSeg: this.workout?.segments?.[this.segIdx + 1], workoutDone: !!this.workoutDone,
      accuracy: this.accuracy,
    };
  }

  summary() {
    const st = this.stats();
    const hrs = this.points.map(p => p.hr).filter(Boolean);
    // último km parcial
    const partial = this.dist - this.lastKmDist;
    return {
      start: this.startTs, end: Date.now(), elapsed: Math.round(st.elapsed), dist: Math.round(this.dist),
      avgPace: st.avgPace, kcal: Math.round(st.kcal), elevGain: Math.round(this.elevGain),
      splits: this.splits, partial: partial > 50 ? { m: Math.round(partial), sec: Math.round(st.elapsed - this.lastKmTime) } : null,
      avgHr: hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null,
      maxHr: hrs.length ? Math.max(...hrs) : null,
      points: this.points, workout: this.workout ? { id: this.workout.id, title: this.workout.title, kind: this.workout.kind, totalSec: this.workout.totalSec } : null,
      completedWorkout: !!this.workoutDone, simulated: this.simulate,
    };
  }

  // Simulador para probar en ordenador sin moverse
  startSim() {
    let lat = 40.4168, lon = -3.7038, heading = Math.random() * 6.28, t = 0;
    const tickSim = () => {
      if (this.state !== 'running') return;
      t++;
      const seg = this.workout?.segments?.[this.segIdx]?.type;
      const base = { walk: 1.5, warmup: 1.6, cooldown: 1.4, fast: 3.9, tempo: 3.4 }[seg] || 2.9;
      const v = (base + Math.sin(t / 40) * 0.25 + (Math.random() - 0.5) * 0.2) * (this.simSpeed || 1);
      heading += (Math.random() - 0.5) * 0.15;
      lat += Math.cos(heading) * v / 111320;
      lon += Math.sin(heading) * v / (111320 * Math.cos(lat * Math.PI / 180));
      this.onPos({ coords: { latitude: lat, longitude: lon, accuracy: 5, altitude: 650 + Math.sin(t / 60) * 8 } });
    };
    this.simTimer = setInterval(tickSim, 1000 / (this.simFast || 1));
  }
}
