// Entrenador por voz: información cada km, cambios de bloque, y ánimos cuando detecta
// variaciones de rendimiento o cada cierto tiempo.
import { sayTime, sayPace, pick } from './util.js';
import { kv } from './store.js';

let voice = null;
function pickVoice() {
  const vs = speechSynthesis.getVoices();
  const pref = kv.get('settings')?.voiceName;
  voice = vs.find(v => v.name === pref) || vs.find(v => v.lang === 'es-ES' && /google|mónica|monica|paulina|jorge|helena|laura/i.test(v.name))
    || vs.find(v => v.lang === 'es-ES') || vs.find(v => v.lang?.startsWith('es')) || null;
}
if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
export function spanishVoices() { return 'speechSynthesis' in window ? speechSynthesis.getVoices().filter(v => v.lang?.startsWith('es')) : []; }

let actx;
export function beep(pattern = [880], dur = 0.12) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    let t = actx.currentTime;
    for (const f of pattern) {
      const o = actx.createOscillator(), g = actx.createGain();
      o.frequency.value = f; o.type = 'sine';
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.4, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur + 0.02); t += dur + 0.06;
    }
  } catch {}
}

let onSpeak = () => {};
export function setSpeakListener(fn) { onSpeak = fn; }

export function speak(text, { priority = false } = {}) {
  onSpeak(text);
  const s = kv.get('settings') || {};
  if (s.voice === false || !('speechSynthesis' in window)) return;
  if (priority) speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'es-ES'; if (voice) u.voice = voice;
  u.rate = s.voiceRate || 1.02; u.pitch = 1; u.volume = 1;
  speechSynthesis.speak(u);
}
// Desbloquear audio en iOS/Android: llamar dentro de un gesto del usuario
export function unlockAudio() {
  try { speechSynthesis.speak(Object.assign(new SpeechSynthesisUtterance(' '), { volume: 0 })); } catch {}
  beep([1], 0.01);
}

const CHEER = [
  '¡Vas genial! Mantén ese ritmo.', '¡Muy bien! Cada paso cuenta.', 'Respira profundo y suelta los hombros. ¡Lo estás haciendo de lujo!',
  'La constancia es tu superpoder. ¡Sigue así!', 'Zancada corta y ligera, brazos relajados. ¡Bien!', 'Estás más fuerte que ayer. ¡Adelante!',
  'Recuerda: hoy entrenas para el corredor que serás mañana.', '¡Qué buena sesión estás haciendo!', 'Mirada al frente, pecho abierto. ¡Vamos!',
];
const FASTER = [
  '¡Estás acelerando! El último tramo vas {d} más rápido que tu media. ¡Bravo!',
  '¡Ese ritmo es fantástico! Has mejorado {d} sobre tu media.',
];
const FASTER_EASY = ['Vas {d} más rápido que tu media. Hoy toca suave: frena un poco y guarda energía.'];
const SLOWER = [
  'Te noto algo más lento, un {d}. Es normal: respira, relaja los brazos y vuelve a tu ritmo.',
  'Ha bajado un poco el ritmo. Concéntrate en la cadencia, pasos cortos y rápidos. ¡Tú puedes!',
  'Si estás cansado, está bien bajar un poco. Lo importante es terminar fuerte.',
];

export class Coach {
  constructor({ workout, profile, best }) {
    this.workout = workout; this.profile = profile || {};
    this.best = best || { maxDist: 0 };
    this.lastSpoke = Date.now(); this.lastPerf = Date.now(); this.lastPeriodic = Date.now();
    this.halfDone = false; this.recordDone = false;
    const s = kv.get('settings') || {};
    this.periodicMin = s.cheerEvery || 5;
    this.kmEvery = s.kmEvery || 1000;
  }
  say(t, o) { this.lastSpoke = Date.now(); speak(t, o); }

  start() {
    const w = this.workout;
    const name = this.profile.name ? `, ${this.profile.name}` : '';
    if (w?.segments) this.say(`¡Vamos${name}! Hoy toca: ${w.title}. Empezamos con ${w.segments[0].label}.`, { priority: true });
    else this.say(`¡Vamos${name}! Carrera libre. Te informaré cada kilómetro.`, { priority: true });
  }

  segmentChange(seg, idx, total) {
    const map = { run: [988, 1318], fast: [1318, 1318, 1318], walk: [660, 440], easy: [880, 988], tempo: [988, 1174], warmup: [660], cooldown: [660, 440] };
    beep(map[seg.type] || [880]);
    const remaining = total - idx - 1;
    const verb = { run: '¡A correr!', fast: '¡Ahora fuerte!', walk: 'Camina.', easy: 'Ritmo suave.', tempo: 'Ritmo tempo.', warmup: 'Calentamiento.', cooldown: 'Vuelta a la calma.' }[seg.type] || '';
    this.say(`${verb} ${seg.label}, ${sayTime(seg.dur)}.${remaining === 1 ? ' Último bloque.' : ''}`, { priority: true });
  }
  countdown(n) { beep([n === 1 ? 1100 : 760], 0.08); }

  km(km, split, st) {
    const parts = [`Kilómetro ${km}.`, `Tiempo ${sayTime(st.elapsed)}.`, `Último kilómetro, ${sayPace(split.sec)}.`];
    if (km > 1) parts.push(`Ritmo medio, ${sayPace(st.avgPace)}.`);
    if (st.hr) parts.push(`Pulso ${st.hr}.`);
    if (km > 1 && st.prevSplit) {
      const d = split.sec - st.prevSplit;
      if (d < -8) parts.push(pick(['¡Más rápido que el anterior, genial!', '¡Has bajado el tiempo, sigue así!']));
      else if (d > 15) parts.push('Algo más lento que el anterior; mantén la calma y sigue.');
    }
    this.say(parts.join(' '));
    this.lastPerf = Date.now();
  }

  // llamado cada segundo
  tick(st) {
    const now = Date.now();
    const w = this.workout;
    // mitad de la sesión
    if (!this.halfDone && w?.totalSec && st.elapsed >= w.totalSec / 2) {
      this.halfDone = true; this.say('¡Mitad de la sesión completada! Lo que queda ya es cuesta abajo.');
      return;
    }
    // récord de distancia
    if (!this.recordDone && this.best.maxDist > 1000 && st.dist > this.best.maxDist) {
      this.recordDone = true; this.say('¡Nuevo récord! Es la mayor distancia que has recorrido con Runnin-G. ¡Enhorabuena!');
      return;
    }
    // pulso demasiado alto en sesión suave
    if (st.hr && st.hrZone >= 4 && st.segType && ['easy', 'run', 'warmup'].includes(st.segType) && now - this.lastPerf > 90000) {
      this.lastPerf = now; this.say(`Pulso en ${st.hr}, zona ${st.hrZone}. Esta parte es suave: baja un poco el ritmo.`); return;
    }
    // variación de rendimiento (ritmo actual vs medio)
    if (st.dist > 600 && st.curPace && st.avgPace && now - this.lastPerf > 120000 && now - this.lastSpoke > 25000
      && (!st.segType || ['run', 'easy', 'tempo'].includes(st.segType) || !w?.segments)) {
      const diff = (st.avgPace - st.curPace) / st.avgPace; // + = más rápido
      const pct = `${Math.round(Math.abs(diff) * 100)} por ciento`;
      if (diff > 0.08) { this.lastPerf = now; this.say(pick(['easy', 'run'].includes(st.segType) && w?.segments ? FASTER_EASY : FASTER).replace('{d}', pct)); return; }
      if (diff < -0.1) { this.lastPerf = now; this.say(pick(SLOWER).replace('{d}', pct)); return; }
    }
    // ánimo periódico con dato motivador
    if (now - this.lastPeriodic > this.periodicMin * 60000 && now - this.lastSpoke > 60000) {
      this.lastPeriodic = now;
      const facts = [];
      if (st.dist > 300) facts.push(`Llevas ${(st.dist / 1000).toFixed(1).replace('.', ',')} kilómetros.`);
      if (st.kcal > 20) facts.push(`Has quemado unas ${Math.round(st.kcal)} kilocalorías.`);
      if (w?.totalSec) { const left = w.totalSec - st.elapsed; if (left > 60) facts.push(`Quedan ${sayTime(left)}.`); }
      if (this.best.maxDist > 1000 && st.dist < this.best.maxDist) facts.push(`Te faltan ${((this.best.maxDist - st.dist) / 1000).toFixed(1).replace('.', ',')} kilómetros para tu récord de distancia.`);
      this.say(`${pick(CHEER)} ${facts.length ? pick(facts) : ''}`);
    }
  }

  finish(st) {
    this.say(`¡Sesión terminada! ${(st.dist / 1000).toFixed(2).replace('.', ',')} kilómetros en ${sayTime(st.elapsed)}. Ritmo medio ${sayPace(st.avgPace)}. ¡Enhorabuena, gran trabajo!`, { priority: true });
  }
}
