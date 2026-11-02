// Motor de entrenamiento de Runnin-G.
// Principios: progresión gradual (~5-10 % semanal), semana de descarga cada 4,
// polarización (80 % suave / 20 % calidad), fuerza 2x/semana, y adaptación según
// cumplimiento, esfuerzo percibido (RPE), molestias y comentarios del usuario.
import { kv } from './store.js';
import { startOfWeek, isoDay, dayIdx, clamp } from './util.js';

export const LEVELS = {
  zero: 'Empiezo de cero',
  beginner: 'Corro de vez en cuando',
  intermediate: 'Corro con regularidad',
  advanced: 'Corredor/a experimentado/a',
};
export const GOALS = {
  habit: 'Correr con regularidad + forma física y fuerza',
  '5k': 'Correr 5 km',
  '10k': 'Correr 10 km',
  '21k': 'Media maratón',
};

// Fase A: correr/caminar. [segundos corriendo, segundos caminando, repeticiones]
const RUNWALK = [
  [60, 120, 6], [60, 90, 8], [90, 90, 7], [60, 90, 6],      // 0-3 (3 = descarga)
  [120, 60, 7], [180, 90, 5], [300, 120, 4], [240, 90, 4],  // 4-7
  [480, 120, 3], [600, 90, 3], [900, 120, 2], [720, 90, 2], // 8-11
  [1500, 0, 1], [1800, 0, 1],                               // 12-13 continuo
];
const A_LEN = RUNWALK.length;
const LONG_CAP = { habit: 60, '5k': 65, '10k': 85, '21k': 135 }; // min de tirada larga
const START_STAGE = { zero: 0, beginner: 4, intermediate: A_LEN + 2, advanced: A_LEN + 8 };

const RUN_DAYS = { 2: [1, 5], 3: [0, 2, 5], 4: [0, 2, 4, 6], 5: [0, 1, 3, 4, 6] };

export function hrMax(profile) { return Math.round(208 - 0.7 * (profile.age || 40)); }
export function zones(profile) {
  const m = hrMax(profile);
  return [[.5, .6], [.6, .7], [.7, .8], [.8, .9], [.9, 1]].map(([a, b], i) => ({ z: i + 1, from: Math.round(m * a), to: Math.round(m * b) }));
}

export function createPlan(profile) {
  const plan = {
    createdAt: Date.now(),
    weekStart: isoDay(startOfWeek()),
    weekNo: 1,
    stage: START_STAGE[profile.level] ?? 0,
    intensity: 1,
    log: [{ ts: Date.now(), text: `Plan creado: ${GOALS[profile.goal]} (nivel: ${LEVELS[profile.level]}).` }],
  };
  // Edad avanzada, IMC alto o lesiones previas: arranque más prudente
  const bmi = profile.weightKg / ((profile.heightCm / 100) ** 2);
  if ((profile.age >= 55 || bmi >= 30 || (profile.injuries || '').trim()) && plan.stage > 0 && plan.stage < A_LEN) {
    plan.stage = Math.max(0, plan.stage - 2);
    plan.log.push({ ts: Date.now(), text: 'Arranque prudente por edad, IMC o lesiones previas.' });
  }
  kv.set('plan', plan);
  return plan;
}

export const isDeload = stage => stage < A_LEN ? stage % 4 === 3 : (stage - A_LEN) % 4 === 3;
export function phaseName(stage) {
  if (stage < 4) return 'Fase 1 · Adaptación';
  if (stage < 8) return 'Fase 2 · Construir la base';
  if (stage < A_LEN) return 'Fase 3 · Correr continuo';
  const b = stage - A_LEN;
  if (b < 8) return 'Fase 4 · Base aeróbica';
  if (b < 16) return 'Fase 5 · Desarrollo';
  return 'Fase 6 · Rendimiento';
}

function seg(type, dur, label) { return { type, dur: Math.round(dur), label }; }
const WARM = (s = 300) => seg('warmup', s, 'Calentamiento: camina rápido');
const COOL = (s = 300) => seg('cooldown', s, 'Vuelta a la calma: camina suave');

function runWalkWorkout(stage, k, variant) {
  const [r, w, n0] = RUNWALK[stage];
  const n = variant === 'long' ? n0 + 1 : variant === 'short' ? Math.max(1, n0 - 1) : n0;
  const segs = [WARM()];
  for (let i = 0; i < n; i++) {
    segs.push(seg('run', r * k, `Corre suave (${i + 1}/${n})`));
    if (w && i < n - 1) segs.push(seg('walk', w, 'Camina y recupera'));
  }
  segs.push(COOL());
  const runMin = Math.round(r * k * n / 60);
  return {
    kind: 'runwalk',
    title: w ? `Correr/caminar ${n}×${fmtD(r * k)}` : `Carrera continua ${runMin} min`,
    desc: w ? `Alterna ${fmtD(r * k)} corriendo suave y ${fmtD(w)} caminando. Ritmo en el que puedas hablar.` :
      `Carrera continua a ritmo cómodo. Si necesitas caminar, camina 1 min y sigue: eso también suma.`,
    segments: segs, rpeTarget: '4-5',
  };
}
function fmtD(s) { s = Math.round(s); return s % 60 === 0 ? `${s / 60}′` : s < 60 ? `${s}″` : `${Math.floor(s / 60)}′${s % 60}″`; }

function baseWeek(stage, k, goal, nRun) {
  const b = stage - A_LEN;
  let weekly = 90 * Math.pow(1.07, b) * k;
  if (goal === 'habit') weekly = Math.min(weekly, 210);
  if (isDeload(stage)) weekly *= 0.72;
  const longMin = Math.min(LONG_CAP[goal] || 60, weekly * (nRun <= 2 ? 0.5 : 0.33));
  const hasQuality = b >= 2 && !isDeload(stage) && nRun >= 3;
  const qMin = hasQuality ? Math.min(55, weekly * 0.22) : 0;
  const easyCount = nRun - 1 - (hasQuality ? 1 : 0);
  const easyMin = easyCount > 0 ? Math.max(20, (weekly - longMin - qMin) / easyCount) : 0;
  const out = [];
  for (let i = 0; i < easyCount; i++) out.push(easyRun(easyMin, i));
  if (hasQuality) out.push(b % 2 === 0 ? intervals(b, qMin, goal) : tempo(b, qMin, goal));
  out.push(longRun(longMin));
  return out;
}
function easyRun(min, i) {
  const strides = i === 0 && min >= 30;
  const segs = [WARM(240), seg('easy', (min - (strides ? 4 : 0)) * 60, 'Rodaje suave, zona 2')];
  if (strides) for (let j = 0; j < 4; j++) { segs.push(seg('fast', 20, `Progresivo ${j + 1}/4`)); segs.push(seg('walk', 40, 'Recupera')); }
  segs.push(COOL(180));
  return { kind: 'easy', title: `Rodaje suave ${Math.round(min)} min`, desc: `Ritmo conversacional (zona 2).${strides ? ' Termina con 4 progresivos de 20″ para trabajar la técnica.' : ''}`, segments: segs, rpeTarget: '3-4' };
}
function longRun(min) {
  return { kind: 'long', title: `Tirada larga ${Math.round(min)} min`, desc: 'La sesión clave de la semana. Ritmo muy cómodo; el objetivo es el tiempo, no la velocidad. Hidrátate.', segments: [WARM(240), seg('easy', min * 60, 'Tirada larga, ritmo cómodo'), COOL(180)], rpeTarget: '4-5' };
}
function intervals(b, qMin, goal) {
  const rep = goal === '21k' ? 240 : goal === '10k' ? 180 : 120;
  const rec = Math.round(rep * 0.6);
  const n = clamp(Math.round((qMin * 60 - 600) / (rep + rec)), 4, 10);
  const segs = [WARM(), seg('easy', 300, 'Trote suave para entrar en calor')];
  for (let i = 0; i < n; i++) { segs.push(seg('fast', rep, `Serie ${i + 1}/${n}: ritmo fuerte`)); if (i < n - 1) segs.push(seg('walk', rec, 'Recupera trotando o caminando')); }
  segs.push(seg('easy', 300, 'Trote suave')); segs.push(COOL(180));
  return { kind: 'intervals', title: `Series ${n}×${fmtD(rep)}`, desc: `Series a ritmo exigente pero controlado (7-8/10), recuperación de ${fmtD(rec)}. Mejora tu VO₂máx.`, segments: segs, rpeTarget: '7-8' };
}
function tempo(b, qMin, goal) {
  const t = clamp(Math.round(qMin - 15), 10, goal === 'habit' ? 20 : 35);
  if (goal === 'habit') {
    const segs = [WARM(), seg('easy', 300, 'Trote suave')];
    const n = Math.max(4, Math.round(t / 2));
    for (let i = 0; i < n; i++) { segs.push(seg('fast', 60, `Cambio de ritmo ${i + 1}/${n}`)); segs.push(seg('easy', 60, 'Ritmo suave')); }
    segs.push(COOL(240));
    return { kind: 'fartlek', title: `Fartlek ${n}×1′`, desc: 'Juego de ritmos: 1′ alegre, 1′ suave. Divertido y muy eficaz para ganar forma.', segments: segs, rpeTarget: '6-7' };
  }
  return { kind: 'tempo', title: `Tempo ${t} min`, desc: 'Ritmo "cómodamente duro" (6-7/10): puedes decir frases cortas, no conversar.', segments: [WARM(), seg('easy', 300, 'Trote suave'), seg('tempo', t * 60, 'Ritmo tempo sostenido'), seg('easy', 240, 'Trote suave'), COOL(180)], rpeTarget: '6-7' };
}

// Fuerza: circuitos A/B progresivos (peso corporal)
const STRENGTH = {
  A: [
    { name: 'Sentadilla', reps: 10, tip: 'Pecho arriba, rodillas en línea con los pies.' },
    { name: 'Puente de glúteo', reps: 12, tip: 'Aprieta glúteos arriba 2″.' },
    { name: 'Flexiones (inclinadas si hace falta)', reps: 8, tip: 'Cuerpo en bloque.' },
    { name: 'Elevación de talones', reps: 15, tip: 'Baja lento: protege tendón de Aquiles.' },
    { name: 'Plancha frontal', sec: 25, tip: 'No hundas la cadera.' },
  ],
  B: [
    { name: 'Zancadas alternas', reps: 8, tip: 'Por pierna. Rodilla trasera casi al suelo.' },
    { name: 'Puente a una pierna', reps: 8, tip: 'Por pierna. Cadera nivelada.' },
    { name: 'Bird-dog', reps: 8, tip: 'Por lado. Lento y controlado.' },
    { name: 'Subida a escalón (step-up)', reps: 10, tip: 'Por pierna. Empuja con el talón.' },
    { name: 'Plancha lateral', sec: 20, tip: 'Por lado.' },
  ],
};
function strengthWorkout(stage, k, variant) {
  const p = Math.min(stage, 30);
  const rounds = clamp(2 + Math.floor(p / 6), 2, 4);
  const f = (1 + p * 0.04) * k * (isDeload(stage) ? 0.8 : 1);
  const ex = STRENGTH[variant].map(e => ({ ...e, reps: e.reps ? Math.round(e.reps * f) : undefined, sec: e.sec ? Math.round(e.sec * f / 5) * 5 : undefined }));
  return {
    kind: 'strength', title: `Fuerza ${variant}: ${rounds} vueltas`,
    desc: 'Circuito de fuerza para corredores. Descansa 30″ entre ejercicios y 90″ entre vueltas. Calienta 5′ antes.',
    strength: { rounds, exercises: ex }, rpeTarget: '6', estMin: rounds * 7 + 5,
  };
}

export function buildWeek(plan, profile) {
  const nRun = clamp(profile.runDays || 3, 2, 5);
  const nStr = clamp(profile.strengthDays ?? 2, 0, 3);
  const k = plan.intensity || 1;
  const runDays = RUN_DAYS[nRun];
  const free = [0, 1, 2, 3, 4, 5, 6].filter(d => !runDays.includes(d));
  // fuerza en días sin carrera, lo más separados posible (nunca el día previo a la tirada larga)
  const longDay = runDays[runDays.length - 1];
  let cand = free.filter(d => d !== longDay - 1);
  if (cand.length < nStr) cand = free;
  const strDays = [];
  for (let i = 0; i < nStr && cand.length; i++) {
    const idx = Math.round(i * (cand.length - 1) / Math.max(1, nStr - 1));
    const d = cand[Math.min(idx, cand.length - 1)];
    if (!strDays.includes(d)) strDays.push(d);
  }
  if (strDays.length < nStr) for (const d of runDays) if (strDays.length < nStr && !strDays.includes(d)) strDays.push(d); // combinar

  let runs;
  if (plan.stage < A_LEN) {
    runs = runDays.map((_, i) => runWalkWorkout(plan.stage, k, i === runDays.length - 1 ? 'long' : (nRun >= 4 && i === 1 ? 'short' : 'std')));
  } else runs = baseWeek(plan.stage, k, profile.goal, nRun);

  const days = [];
  for (let d = 0; d < 7; d++) {
    const items = [];
    const ri = runDays.indexOf(d);
    if (ri >= 0) items.push({ type: 'run', ...runs[ri] });
    const si = strDays.indexOf(d);
    if (si >= 0) items.push({ type: 'strength', ...strengthWorkout(plan.stage, k, si % 2 ? 'B' : 'A') });
    items.forEach((w, j) => {
      w.id = `${plan.weekStart}:${d}:${j}`;
      if (w.segments) w.totalSec = w.segments.reduce((a, s) => a + s.dur, 0);
    });
    days.push({ day: d, items });
  }
  return days;
}

// --- Adaptación ---
export function feedbackFor(id) { return (kv.get('feedback') || {})[id]; }
export function saveFeedback(id, fb) {
  const all = kv.get('feedback') || {};
  all[id] = { ...fb, ts: Date.now() };
  kv.set('feedback', all);
  // Ajuste inmediato tras una sesión muy dura o con dolor
  const plan = kv.get('plan');
  if (!plan) return null;
  let msg = null;
  if (fb.pain) {
    plan.intensity = clamp(+(plan.intensity - 0.1).toFixed(2), 0.7, 1.15);
    msg = 'Has indicado molestias: reduzco la carga un 10 % en las próximas sesiones. Si el dolor persiste más de 3 días, consulta a un profesional.';
  } else if (fb.rpe >= 9) {
    plan.intensity = clamp(+(plan.intensity - 0.05).toFixed(2), 0.7, 1.15);
    msg = 'Sesión muy exigente: suavizo un 5 % las siguientes para que asimiles el trabajo.';
  } else if (fb.rpe <= 3 && fb.completed) {
    plan.intensity = clamp(+(plan.intensity + 0.03).toFixed(2), 0.7, 1.15);
    msg = 'Te ha resultado fácil: subo ligeramente la exigencia.';
  }
  if (msg) { plan.log.push({ ts: Date.now(), text: msg }); kv.set('plan', plan); }
  return msg;
}

// Al empezar semana nueva, evaluar la anterior y decidir progresión
export function rollWeek(profile) {
  const plan = kv.get('plan');
  if (!plan) return null;
  const current = isoDay(startOfWeek());
  const notes = [];
  while (plan.weekStart < current) {
    const days = buildWeek(plan, profile);
    const planned = days.flatMap(d => d.items);
    const fbAll = kv.get('feedback') || {};
    const done = planned.filter(w => fbAll[w.id]?.completed);
    const runsPlanned = planned.filter(w => w.type === 'run').length;
    const runsDone = done.filter(w => w.type === 'run').length;
    const rpes = done.map(w => fbAll[w.id].rpe).filter(Boolean);
    const avg = rpes.length ? rpes.reduce((a, b) => a + b, 0) / rpes.length : 0;
    const pain = done.some(w => fbAll[w.id].pain);
    const ratio = runsPlanned ? runsDone / runsPlanned : 0;
    let text;
    if (pain) { plan.stage = Math.max(0, plan.stage - 1); text = 'Hubo molestias: retrocedo un escalón para consolidar sin riesgo.'; }
    else if (ratio < 0.5) { text = runsDone === 0 ? 'Semana sin carreras: repetimos el mismo nivel, sin culpa. ¡A por ello!' : 'Cumpliste menos de la mitad: repetimos nivel para afianzar.'; }
    else if (avg >= 8.5) { plan.intensity = clamp(+(plan.intensity - 0.05).toFixed(2), 0.7, 1.15); text = 'Semana muy dura (RPE alto): repetimos nivel con algo menos de carga.'; }
    else if (avg && avg <= 4 && ratio >= 1 && !isDeload(plan.stage + 1)) { plan.stage += 2; text = '¡Semana completa y cómoda! Subo dos escalones.'; }
    else { plan.stage += 1; text = `Semana superada (${runsDone}/${runsPlanned} carreras). Avanzamos.`; }
    const d = new Date(plan.weekStart + 'T00:00:00'); d.setDate(d.getDate() + 7);
    plan.weekStart = isoDay(d); plan.weekNo++;
    plan.log.push({ ts: Date.now(), text: `Semana ${plan.weekNo - 1}: ${text}` });
    notes.push(text);
  }
  kv.set('plan', plan);
  return notes;
}

export function applyAdjustment(adj) {
  const plan = kv.get('plan');
  if (!plan || !adj) return null;
  const parts = [];
  if (typeof adj.stageDelta === 'number' && adj.stageDelta) {
    const d = clamp(Math.round(adj.stageDelta), -2, 2);
    plan.stage = Math.max(0, plan.stage + d);
    parts.push(d > 0 ? `nivel +${d}` : `nivel ${d}`);
  }
  if (typeof adj.intensity === 'number' && adj.intensity !== 1) {
    const f = clamp(adj.intensity, 0.8, 1.1);
    plan.intensity = clamp(+(plan.intensity * f).toFixed(2), 0.7, 1.15);
    parts.push(`carga ×${f}`);
  }
  if (!parts.length) return null;
  const text = `Ajuste del coach: ${parts.join(', ')}${adj.reason ? ` · ${adj.reason}` : ''}`;
  plan.log.push({ ts: Date.now(), text });
  kv.set('plan', plan);
  return text;
}

export function todayItems(plan, profile) {
  return buildWeek(plan, profile)[dayIdx()].items;
}
