import { $, $$, fmtTime, fmtPace, fmtKm, DAYS, dayIdx, fmtDate, esc, uid, toast, download, routeSvg, startOfWeek, isoDay } from './util.js';
import { kv, sessions, exportBackup, importBackup } from './store.js';
import { LEVELS, GOALS, createPlan, buildWeek, phaseName, isDeload, saveFeedback, feedbackFor, rollWeek, zones, hrMax } from './plan.js';
import { Tracker } from './tracker.js';
import { Coach, speak, unlockAudio, setSpeakListener, spanishVoices } from './coach.js';
import { toKML, toGPX, parseTrackFile } from './export.js';
import { askCoach } from './ai.js';
import { connectHr, disconnectHr, hrState, onHr, hrSupported } from './hr.js';

const view = $('#view');
let tab = 'today';
let tracker = null, coach = null, map = null;

const settings = () => ({ voice: true, cheerEvery: 5, simulate: false, speakReplies: true, ...(kv.get('settings') || {}) });
const profile = () => kv.get('profile');
const plan = () => kv.get('plan');

// ---------- Navegación ----------
$$('#tabbar button').forEach(b => b.onclick = () => go(b.dataset.tab));
function go(t, arg) {
  if (tracker && tracker.state !== 'stopped' && t !== 'run') return;
  tab = t;
  $$('#tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
  window.scrollTo(0, 0);
  ({ today: renderToday, plan: renderPlan, run: renderPreRun, history: renderHistory, coach: renderCoach, detail: renderDetail }[t])(arg);
}
$('#settingsBtn').onclick = () => openSettings();
$('#hrBtn').onclick = async () => {
  if (hrState.connected) { disconnectHr(); return; }
  try { await connectHr(); toast(`❤ Conectado: ${hrState.name}`); } catch (e) { if (e.name !== 'NotFoundError') toast(e.message); }
};
onHr(s => { $('#hrBtn').classList.toggle('on', s.connected); $('#hrBtn').textContent = s.connected && s.bpm ? s.bpm : '❤'; tracker?.setHr(s.bpm); });

function modal(html, onMount) {
  $('#modalCard').innerHTML = html; $('#modal').classList.remove('hidden');
  onMount?.($('#modalCard'));
}
function closeModal() { $('#modal').classList.add('hidden'); $('#modalCard').innerHTML = ''; }
$('#modal').onclick = e => { if (e.target.id === 'modal' && !$('#modalCard').dataset.locked) closeModal(); };

// ---------- Onboarding ----------
function renderOnboarding(edit = false) {
  const p = profile() || { name: '', age: 40, sex: '', weightKg: 75, heightCm: 175, level: 'zero', goal: 'habit', runDays: 3, strengthDays: 2, injuries: '' };
  let step = 0;
  const steps = [
    () => `<h1>Bienvenido a <span class="grad-text">Runnin-G</span></h1><p class="muted">Tu entrenador personal de running. Te voy a hacer unas preguntas para diseñar un plan a tu medida.</p>
      <label>¿Cómo te llamas?</label><input id="f-name" value="${esc(p.name)}" placeholder="Tu nombre">
      <div class="grid2"><div><label>Edad</label><input id="f-age" type="number" value="${p.age}"></div>
      <div><label>Sexo</label><select id="f-sex"><option value="">Prefiero no decir</option><option value="m" ${p.sex === 'm' ? 'selected' : ''}>Hombre</option><option value="f" ${p.sex === 'f' ? 'selected' : ''}>Mujer</option></select></div>
      <div><label>Peso (kg)</label><input id="f-w" type="number" value="${p.weightKg}"></div><div><label>Altura (cm)</label><input id="f-h" type="number" value="${p.heightCm}"></div></div>`,
    () => `<h1>Tu punto de partida</h1><p class="muted">Sé sincero: empezar en el nivel justo es la mejor forma de no lesionarse.</p>
      <div class="seg" id="f-level" style="flex-direction:column">${Object.entries(LEVELS).map(([k, v]) => `<button data-v="${k}" class="${p.level === k ? 'on' : ''}">${v}</button>`).join('')}</div>
      <label>¿Lesiones, dolencias o limitaciones?</label><textarea id="f-inj" rows="2" placeholder="Ej.: rodilla derecha sensible, asma…">${esc(p.injuries)}</textarea>`,
    () => `<h1>Tu meta</h1><div class="seg" id="f-goal" style="flex-direction:column">${Object.entries(GOALS).map(([k, v]) => `<button data-v="${k}" class="${p.goal === k ? 'on' : ''}">${v}</button>`).join('')}</div>
      <label>Días de carrera por semana</label><div class="seg" id="f-rd">${[2, 3, 4, 5].map(n => `<button data-v="${n}" class="${p.runDays === n ? 'on' : ''}">${n}</button>`).join('')}</div>
      <label>Días de fuerza por semana</label><div class="seg" id="f-sd">${[0, 1, 2, 3].map(n => `<button data-v="${n}" class="${p.strengthDays === n ? 'on' : ''}">${n}</button>`).join('')}</div>
      <p class="small muted">Recomendado para coger forma y masa muscular: 3 días de carrera y 2 de fuerza.</p>`,
  ];
  const save = () => {
    const v = id => $(id)?.value;
    if (step === 0) Object.assign(p, { name: v('#f-name').trim(), age: +v('#f-age') || 40, sex: v('#f-sex'), weightKg: +v('#f-w') || 75, heightCm: +v('#f-h') || 175 });
    if (step === 1) p.injuries = v('#f-inj');
  };
  const draw = () => {
    view.innerHTML = `<div class="onb">${step === 0 ? '<img class="logo" src="icons/icon.svg" alt="">' : ''}
      <div class="steps-dots">${steps.map((_, i) => `<span class="${i === step ? 'on' : ''}"></span>`).join('')}</div>
      <div class="card">${steps[step]()}</div>
      <div class="row">${step ? '<button class="btn ghost" id="back">Atrás</button>' : ''}<button class="btn primary block" id="next">${step === steps.length - 1 ? (edit ? 'Guardar y recalcular plan' : 'Crear mi plan') : 'Siguiente'}</button></div></div>`;
    const bindSeg = (id, key, num) => $$(`${id} button`).forEach(b => b.onclick = () => { p[key] = num ? +b.dataset.v : b.dataset.v; $$(`${id} button`).forEach(x => x.classList.toggle('on', x === b)); });
    bindSeg('#f-level', 'level'); bindSeg('#f-goal', 'goal'); bindSeg('#f-rd', 'runDays', 1); bindSeg('#f-sd', 'strengthDays', 1);
    $('#back') && ($('#back').onclick = () => { save(); step--; draw(); });
    $('#next').onclick = () => {
      save();
      if (step < steps.length - 1) { step++; draw(); return; }
      kv.set('profile', p);
      if (!edit || !plan()) createPlan(p);
      else if (confirm('¿Reiniciar el plan desde tu nuevo nivel? (Cancelar = mantener progreso y solo actualizar días)')) createPlan(p);
      document.querySelector('.tabbar').style.display = '';
      toast('¡Plan listo! 💪'); go('today');
    };
  };
  document.querySelector('.tabbar').style.display = 'none';
  draw();
}

// ---------- HOY ----------
async function renderToday() {
  const p = profile(), pl = plan();
  const week = buildWeek(pl, p);
  const fb = kv.get('feedback') || {};
  const all = await sessions.all();
  const wkStart = startOfWeek().getTime();
  const wkSessions = all.filter(s => s.start >= wkStart);
  const wkKm = wkSessions.reduce((a, s) => a + s.dist, 0) / 1000;
  const planned = week.flatMap(d => d.items);
  const doneN = planned.filter(w => fb[w.id]?.completed).length;
  const pct = planned.length ? doneN / planned.length : 0;
  const today = week[dayIdx()].items;
  const h = new Date().getHours();
  const hello = h < 13 ? 'Buenos días' : h < 21 ? 'Buenas tardes' : 'Buenas noches';
  const lastLog = pl.log[pl.log.length - 1];
  const streak = calcStreak(all);
  const C = 2 * Math.PI * 40;

  view.innerHTML = `
    <div class="card hero">
      <div class="row between">
        <div><div class="muted small">${hello}${p.name ? ', ' + esc(p.name) : ''}</div>
          <h1>Semana ${pl.weekNo}</h1><div class="small muted">${phaseName(pl.stage)}${isDeload(pl.stage) ? ' · <span style="color:var(--cyan)">descarga</span>' : ''}</div></div>
        <div class="ring"><svg width="96" height="96"><circle cx="48" cy="48" r="40" stroke="#24304d" stroke-width="9" fill="none"/>
          <circle cx="48" cy="48" r="40" stroke="url(#rgr)" stroke-width="9" fill="none" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}"/>
          <defs><linearGradient id="rgr"><stop offset="0" stop-color="#ff3d7f"/><stop offset="1" stop-color="#c6ff3d"/></linearGradient></defs></svg>
          <div class="lbl"><div><div style="font-size:22px">${doneN}/${planned.length}</div><div class="small muted" style="font-weight:500">sesiones</div></div></div></div>
      </div>
      <div class="grid3" style="margin-top:14px">
        <div class="stat"><div class="v">${wkKm.toFixed(1)}</div><div class="l">km semana</div></div>
        <div class="stat"><div class="v">${streak}</div><div class="l">semanas seguidas</div></div>
        <div class="stat"><div class="v">${(all.reduce((a, s) => a + s.dist, 0) / 1000).toFixed(0)}</div><div class="l">km totales</div></div>
      </div>
    </div>
    <h2>Hoy · ${new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
    ${today.length ? today.map(w => workoutCard(w, fb[w.id], true)).join('') : `<div class="card"><h3>Día de descanso 😌</h3><p class="muted small" style="margin:0">El descanso es cuando tu cuerpo se hace más fuerte. Camina, estira o haz movilidad suave. Si te apetece, puedes hacer una carrera libre.</p></div>`}
    <h2>Tu semana</h2>
    <div class="week">${week.map(d => {
      const done = d.items.length && d.items.every(w => fb[w.id]?.completed);
      const icons = d.items.map(w => w.type === 'run' ? '🏃' : '💪').join('') || '·';
      return `<div class="day ${d.day === dayIdx() ? 'today' : ''} ${done ? 'done' : ''}" data-day="${d.day}"><div class="d">${DAYS[d.day]}</div><div class="i">${done ? '✓' : icons}</div></div>`;
    }).join('')}</div>
    ${lastLog ? `<h2>Tu coach dice</h2><div class="card"><p style="margin:0">✦ ${esc(lastLog.text)}</p></div>` : ''}
    <button class="btn block" id="freeRun" style="margin-top:4px">▶ Carrera libre</button>
  `;
  bindWorkoutButtons();
  $$('.day').forEach(d => d.onclick = () => go('plan', +d.dataset.day));
  $('#freeRun').onclick = () => go('run', null);
}
function calcStreak(all) {
  let n = 0; const ws = startOfWeek();
  for (let i = 0; i < 104; i++) {
    const a = new Date(ws); a.setDate(a.getDate() - 7 * i); const b = new Date(a); b.setDate(b.getDate() + 7);
    const has = all.some(s => s.start >= a && s.start < b);
    if (has) n++; else if (i > 0) break;
  }
  return n;
}

function segBar(w) {
  if (!w.segments) return '';
  return `<div class="segbar">${w.segments.map(s => `<span class="s-${s.type}" style="flex:${s.dur}" title="${esc(s.label)}"></span>`).join('')}</div>`;
}
function workoutCard(w, fb, actions) {
  const dur = w.totalSec ? `${Math.round(w.totalSec / 60)} min` : w.estMin ? `~${w.estMin} min` : '';
  return `<div class="card">
    <div class="row between"><span class="chip ${w.type}">${w.type === 'run' ? '🏃 Carrera' : '💪 Fuerza'}</span>
      <span class="row">${fb?.completed ? `<span class="chip done">✓ Hecho · RPE ${fb.rpe}</span>` : ''}<span class="muted small">${dur}</span></span></div>
    <h3 style="margin-top:10px">${esc(w.title)}</h3>
    <p class="muted small" style="margin:4px 0">${esc(w.desc)} <b style="color:var(--text)">Esfuerzo objetivo: ${w.rpeTarget}/10.</b></p>
    ${segBar(w)}
    ${w.strength ? `<div class="small muted">${w.strength.exercises.map(e => e.name).join(' · ')}</div>` : ''}
    ${actions ? `<div class="row" style="margin-top:12px">
      <button class="btn primary block" data-start="${w.id}">${w.type === 'run' ? '▶ Empezar' : 'Ver circuito'}</button>
      ${!fb?.completed ? `<button class="btn sm" data-mark="${w.id}" title="Marcar como hecho sin registrar">✓</button>` : ''}</div>` : ''}
  </div>`;
}
function findWorkout(id) {
  const week = buildWeek(plan(), profile());
  return week.flatMap(d => d.items).find(w => w.id === id);
}
function bindWorkoutButtons() {
  $$('[data-start]').forEach(b => b.onclick = () => {
    const w = findWorkout(b.dataset.start);
    if (w.type === 'run') go('run', w); else openStrength(w);
  });
  $$('[data-mark]').forEach(b => b.onclick = () => openFeedback(findWorkout(b.dataset.mark), null));
}

// ---------- PLAN ----------
function renderPlan(focusDay) {
  const p = profile(), pl = plan();
  const week = buildWeek(pl, p);
  const fb = kv.get('feedback') || {};
  const z = zones(p);
  view.innerHTML = `
    <div class="card hero"><div class="muted small">Semana ${pl.weekNo}</div><h1>${phaseName(pl.stage)}</h1>
      <p class="small muted" style="margin:6px 0 0">${GOALS[p.goal]} · ${p.runDays} carreras + ${p.strengthDays} fuerza/semana · carga ×${pl.intensity}${isDeload(pl.stage) ? ' · <b style="color:var(--cyan)">Semana de descarga</b>: menos volumen para asimilar.' : ''}</p></div>
    ${week.map(d => `<div id="pd-${d.day}"><h2 style="margin-top:16px">${DAYS[d.day]}${d.day === dayIdx() ? ' · <span class="grad-text">hoy</span>' : ''}</h2>
      ${d.items.length ? d.items.map(w => workoutCard(w, fb[w.id], true)).join('') : '<div class="card muted small">Descanso activo: paseo, movilidad o estiramientos.</div>'}</div>`).join('')}
    <h2>Zonas de pulso</h2>
    <div class="card small">${z.map(x => `<div class="exercise"><span>Zona ${x.z} ${['· recuperación', '· suave (rodajes)', '· aeróbica', '· umbral', '· máxima'][x.z - 1]}</span><b>${x.from}-${x.to} ppm</b></div>`).join('')}
      <p class="muted" style="margin:8px 0 0">FC máx estimada ${hrMax(p)} ppm (fórmula de Tanaka). Conecta un pulsómetro con ❤.</p></div>
    <h2>Cómo se adapta tu plan</h2>
    <div class="card small">${pl.log.slice(-8).reverse().map(l => `<div class="exercise"><span>${esc(l.text)}</span><span class="muted" style="white-space:nowrap;margin-left:8px">${new Date(l.ts).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}</span></div>`).join('')}</div>
    <p class="muted small">Cada semana evalúo cuántas sesiones completaste, tu esfuerzo percibido (RPE) y si hubo molestias, y decido si avanzar, repetir o retroceder. Lo que le cuentes al coach también ajusta la carga.</p>
  `;
  bindWorkoutButtons();
  if (focusDay != null) setTimeout(() => $(`#pd-${focusDay}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
}

function openStrength(w) {
  modal(`<div class="row between"><h1>${esc(w.title)}</h1><button class="icon-btn" id="mClose">✕</button></div>
    <p class="muted small">${esc(w.desc)}</p>
    <div class="card">${w.strength.exercises.map(e => `<div class="exercise"><div><b>${esc(e.name)}</b><div class="muted small">${esc(e.tip)}</div></div><div class="num" style="font-size:20px;white-space:nowrap">${e.reps ? e.reps + ' rep' : e.sec + '″'}</div></div>`).join('')}</div>
    <div class="card row between"><div><div class="muted small">Vueltas</div><div class="num" style="font-size:28px">${w.strength.rounds}</div></div>
      <div style="text-align:right"><div class="muted small">Temporizador</div><div class="num" id="sTimer" style="font-size:28px">00:00</div></div></div>
    <div class="row"><button class="btn block" id="sStart">▶ Iniciar</button><button class="btn primary block" id="sDone">✓ Terminado</button></div>`, el => {
    let h = null; el._acc = 0;
    $('#mClose', el).onclick = () => { clearInterval(h); closeModal(); };
    $('#sStart', el).onclick = () => {
      if (h) { clearInterval(h); h = null; $('#sStart', el).textContent = '▶ Seguir'; return; }
      unlockAudio(); if (!el._acc) speak(`Circuito de fuerza, ${w.strength.rounds} vueltas. Empezamos con ${w.strength.exercises[0].name}.`);
      const start = Date.now() - (el._acc || 0);
      h = setInterval(() => { el._acc = Date.now() - start; $('#sTimer', el).textContent = fmtTime(el._acc / 1000); }, 500);
      $('#sStart', el).textContent = '⏸ Pausa';
    };
    $('#sDone', el).onclick = () => { clearInterval(h); closeModal(); openFeedback(w, null); };
  });
}

// ---------- CORRER ----------
let selectedWorkout = null;
function renderPreRun(w) {
  if (tracker && tracker.state !== 'stopped') return renderRunning();
  const today = buildWeek(plan(), profile())[dayIdx()].items.filter(x => x.type === 'run');
  const fb = kv.get('feedback') || {};
  selectedWorkout = w === undefined ? (today.find(x => !fb[x.id]?.completed) || null) : w;
  const st = settings();
  view.innerHTML = `
    <h1>¿Listo para correr?</h1>
    <p class="muted small">Elige tu sesión. El coach te guiará por voz.</p>
    ${today.map(x => `<div class="card sel-w" data-id="${x.id}" style="cursor:pointer;${selectedWorkout?.id === x.id ? 'border-color:var(--lime)' : ''}"><div class="row between"><h3>${esc(x.title)}</h3>${fb[x.id]?.completed ? '<span class="chip done">✓</span>' : ''}</div><div class="muted small">${Math.round(x.totalSec / 60)} min · objetivo ${x.rpeTarget}/10</div>${segBar(x)}</div>`).join('')}
    <div class="card sel-w" data-id="" style="cursor:pointer;${!selectedWorkout ? 'border-color:var(--lime)' : ''}"><h3>Carrera libre</h3><div class="muted small">Sin bloques. Info cada km y ánimos según tu rendimiento.</div></div>
    <div class="card row between"><div><div class="small muted">GPS</div><div id="gpsStatus" class="pulse">Buscando señal…</div></div>
      <div style="text-align:right"><div class="small muted">Voz</div><div>${st.voice ? '🔊 activada' : '🔇 desactivada'}</div></div></div>
    ${st.simulate ? '<div class="card small" style="border-color:var(--warn);color:var(--warn)">Modo simulación activado (Ajustes): se generará una ruta ficticia.</div>' : ''}
    <button class="btn primary block" id="go" style="padding:20px;font-size:18px">▶ EMPEZAR</button>
  `;
  $$('.sel-w').forEach(c => c.onclick = () => {
    selectedWorkout = c.dataset.id ? today.find(x => x.id === c.dataset.id) : null;
    $$('.sel-w').forEach(x => x.style.borderColor = x === c ? 'var(--lime)' : '');
  });
  if (!st.simulate && 'geolocation' in navigator) {
    navigator.geolocation.getCurrentPosition(p => { const g = $('#gpsStatus'); if (g) { g.classList.remove('pulse'); g.textContent = `✓ Precisión ${Math.round(p.coords.accuracy)} m`; } },
      e => { const g = $('#gpsStatus'); if (g) { g.classList.remove('pulse'); g.textContent = `⚠ ${e.code === 1 ? 'Permiso denegado' : 'Sin señal'}`; } }, { enableHighAccuracy: true, timeout: 15000 });
  } else if (st.simulate) { $('#gpsStatus').classList.remove('pulse'); $('#gpsStatus').textContent = 'Simulado'; }
  $('#go').onclick = () => startRun(selectedWorkout);
}

async function startRun(w) {
  unlockAudio();
  const p = profile();
  const all = await sessions.all();
  const best = { maxDist: Math.max(0, ...all.map(s => s.dist)) };
  coach = new Coach({ workout: w, profile: p, best });
  const st = settings();
  tracker = new Tracker({
    workout: w, weightKg: p.weightKg, simulate: st.simulate,
    onUpdate: s => { updateRunUI(s); if (Math.floor(s.elapsed) % 10 === 0 && s.state === 'running') kv.set('activeRun', tracker.summary()); coach.tick({ ...s, hrZone: hrZoneOf(s.hr) }); },
    onKm: (split, s) => { coach.km(split.km, split, s); flashKm(split); },
    onSegment: (seg, i, n) => {
      if (!seg) { speak('¡Sesión planificada completada! Puedes seguir corriendo o terminar cuando quieras.', { priority: true }); return; }
      if (i > 0) coach.segmentChange(seg, i, n);
    },
    onCountdown: n => coach.countdown(n),
    onGps: g => { const el = $('#gpsBadge'); if (el) el.textContent = g.error ? `⚠ ${g.error}` : `GPS ±${Math.round(g.acc)} m`; if (!g.error) updateMap(g); },
  });
  if (hrState.bpm) tracker.setHr(hrState.bpm);
  document.body.classList.add('running');
  renderRunning();
  coach.start();
  await tracker.start();
}
function hrZoneOf(hr) {
  if (!hr) return 0;
  const z = zones(profile()); for (let i = z.length - 1; i >= 0; i--) if (hr >= z[i].from) return z[i].z; return 1;
}

let speakTimer;
setSpeakListener(text => {
  const b = $('#coachBubble'); if (!b) return;
  b.textContent = '✦ ' + text; b.classList.add('show');
  clearTimeout(speakTimer); speakTimer = setTimeout(() => b.classList.remove('show'), 7000);
});

function renderRunning() {
  view.innerHTML = `<div class="run-screen">
    <div class="run-map"><div id="map"></div><span class="chip gps-badge" id="gpsBadge">GPS…</span><div class="coach-bubble" id="coachBubble"></div></div>
    <div class="run-panel">
      <div id="cue" class="cue other" style="display:none"></div>
      <div class="big"><div class="num" id="rDist">0.00</div><div class="unit">kilómetros</div></div>
      <div class="run-stats">
        <div class="stat"><div class="v" id="rTime">00:00</div><div class="l">tiempo</div></div>
        <div class="stat"><div class="v" id="rPace">--:--</div><div class="l">ritmo actual</div></div>
        <div class="stat"><div class="v" id="rAvg">--:--</div><div class="l">ritmo medio</div></div>
        <div class="stat"><div class="v" id="rKm">--:--</div><div class="l">km en curso</div></div>
        <div class="stat"><div class="v" id="rLast">--:--</div><div class="l">último km</div></div>
        <div class="stat"><div class="v" id="rHr">${hrState.connected ? '--' : '❤'}</div><div class="l" id="rHrL">${hrState.connected ? 'pulso' : 'kcal'}</div></div>
      </div>
      <div class="run-controls" id="ctrls">
        <button class="btn" id="rPause">⏸ Pausa</button>
        <button class="btn danger" id="rStop" style="display:none">■ Terminar</button>
      </div>
    </div></div>`;
  initMap();
  $('#rPause').onclick = () => {
    if (tracker.state === 'running') { tracker.pause(); speak('Pausa.'); $('#rPause').textContent = '▶ Seguir'; $('#rStop').style.display = ''; }
    else { tracker.resume(); speak('Seguimos.'); $('#rPause').textContent = '⏸ Pausa'; $('#rStop').style.display = 'none'; }
  };
  $('#rStop').onclick = () => finishRun();
}

function updateRunUI(s) {
  if (!$('#rDist')) return;
  $('#rDist').textContent = fmtKm(s.dist);
  $('#rTime').textContent = fmtTime(s.elapsed);
  $('#rPace').textContent = fmtPace(s.curPace);
  $('#rAvg').textContent = fmtPace(s.avgPace);
  $('#rKm').textContent = fmtPace(s.kmPace);
  $('#rLast').textContent = s.lastSplit ? fmtPace(s.lastSplit.sec) : '--:--';
  if (hrState.connected) { $('#rHr').textContent = s.hr || '--'; $('#rHrL').textContent = `pulso${s.hr ? ' · Z' + hrZoneOf(s.hr) : ''}`; }
  else { $('#rHr').textContent = Math.round(s.kcal); }
  const cue = $('#cue');
  if (s.seg && !s.workoutDone) {
    const cls = { run: 'run', easy: 'run', fast: 'fast', tempo: 'fast', walk: 'walk' }[s.seg.type] || 'other';
    cue.className = `cue ${cls}`; cue.style.display = '';
    cue.innerHTML = `${esc(s.seg.label)} · ${fmtTime(s.segLeft)}<small>Bloque ${s.segIdx + 1}/${tracker.workout.segments.length}${s.nextSeg ? ' · después: ' + esc(s.nextSeg.label) : ''}</small>`;
  } else if (s.workoutDone) { cue.className = 'cue run'; cue.style.display = ''; cue.innerHTML = '✓ Sesión completada<small>Pulsa pausa y termina cuando quieras</small>'; }
  if (s.state === 'paused') $('#rTime').classList.add('pulse'); else $('#rTime').classList.remove('pulse');
}
function flashKm(split) { toast(`Km ${split.km} · ${fmtPace(split.sec)} /km`); }

let routeLine, meMarker;
function initMap() {
  if (!window.L) { $('#map').innerHTML = '<div class="empty">Mapa no disponible sin conexión.<br>La ruta se graba igualmente.</div>'; map = null; return; }
  map = L.map('map', { zoomControl: false, attributionControl: true }).setView([40.4168, -3.7038], 16);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19, attribution: '© OpenStreetMap © CARTO' }).addTo(map);
  routeLine = L.polyline([], { color: '#c6ff3d', weight: 5, opacity: .95 }).addTo(map);
  meMarker = null;
}
function updateMap(g) {
  if (!map) return;
  const ll = [g.lat, g.lon];
  if (!meMarker) { meMarker = L.circleMarker(ll, { radius: 8, color: '#070a14', weight: 3, fillColor: '#ff3d7f', fillOpacity: 1 }).addTo(map); map.setView(ll, 17); }
  meMarker.setLatLng(ll);
  if (tracker) routeLine.setLatLngs(tracker.points.map(p => [p.lat, p.lon]));
  map.panTo(ll, { animate: true });
}

async function finishRun() {
  const s = tracker.stop();
  kv.del('activeRun');
  coach.finish({ dist: s.dist, elapsed: s.elapsed, avgPace: s.avgPace });
  document.body.classList.remove('running');
  const session = { id: uid(), ...s, planId: s.workout?.id };
  tracker = null; map = null;
  if (s.dist < 30 && s.elapsed < 30) { toast('Sesión demasiado corta: no se guarda'); go('today'); return; }
  await sessions.put(session);
  go('detail', session.id);
  const w = s.workout?.id ? findWorkout(s.workout.id) : null;
  setTimeout(() => openFeedback(w, session), 400);
}

// ---------- Feedback post-sesión ----------
function openFeedback(w, session) {
  let rpe = 0, pain = false, feel = '';
  modal(`<h1>¿Cómo ha ido?</h1><p class="muted small">Tu respuesta adapta el plan. ${w ? 'Sesión: ' + esc(w.title) : 'Carrera libre'}</p>
    <label>Esfuerzo percibido (1 = paseo, 10 = máximo)</label>
    <div class="rpe" id="rpe">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => `<button data-v="${n}">${n}</button>`).join('')}</div>
    <label>Sensaciones</label><div class="seg" id="feel">${['😄 Genial', '🙂 Bien', '😐 Normal', '😮‍💨 Cansado', '🥵 Muy duro'].map(f => `<button data-v="${f}">${f}</button>`).join('')}</div>
    <label>¿Alguna molestia o dolor?</label><div class="seg" id="pain"><button data-v="0" class="on">No</button><button data-v="1">Sí</button></div>
    <label>Comentario para el coach (opcional)</label><textarea id="fbNote" rows="2" placeholder="Ej.: me ha costado la segunda mitad, he dormido poco…"></textarea>
    ${w ? `<label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="fbDone" checked style="width:auto"> He completado la sesión</label>` : ''}
    <button class="btn primary block" id="fbSave" style="margin-top:14px">Guardar</button>`, el => {
    el.dataset.locked = '1';
    $$('#rpe button', el).forEach(b => b.onclick = () => { rpe = +b.dataset.v; $$('#rpe button', el).forEach(x => x.classList.toggle('on', x === b)); });
    $$('#feel button', el).forEach(b => b.onclick = () => { feel = b.dataset.v; $$('#feel button', el).forEach(x => x.classList.toggle('on', x === b)); });
    $$('#pain button', el).forEach(b => b.onclick = () => { pain = b.dataset.v === '1'; $$('#pain button', el).forEach(x => x.classList.toggle('on', x === b)); });
    $('#fbSave', el).onclick = async () => {
      if (!rpe) { toast('Indica tu esfuerzo (1-10)'); return; }
      const note = $('#fbNote', el).value.trim();
      const completed = w ? $('#fbDone', el).checked : true;
      delete el.dataset.locked; closeModal();
      let msg = null;
      if (w) msg = saveFeedback(w.id, { rpe, pain, feel, note, completed, sessionId: session?.id });
      if (session) { Object.assign(session, { rpe, pain, feel, note }); await sessions.put(session); }
      if (msg) { toast(msg, 5000); speak(msg); }
      else toast('¡Guardado! 💪');
      if (note && settings().apiKey) {
        askCoach(`Acabo de terminar ${w ? w.title : 'una carrera libre'}${session ? ` (${fmtKm(session.dist)} km en ${fmtTime(session.elapsed)})` : ''}. RPE ${rpe}/10, sensaciones: ${feel || 'sin indicar'}, molestias: ${pain ? 'sí' : 'no'}. Comentario: ${note}`)
          .then(r => { toast('El coach te ha respondido ✦', 4000); if (settings().speakReplies) speak(r.reply); }).catch(() => {});
      }
      if (tab === 'detail' && session) renderDetail(session.id); else if (tab !== 'detail') go(tab);
    };
  });
}

// ---------- HISTORIAL ----------
async function renderHistory() {
  const all = await sessions.all();
  const tot = all.reduce((a, s) => ({ d: a.d + s.dist, t: a.t + s.elapsed }), { d: 0, t: 0 });
  // km por semana (últimas 8)
  const weeks = [];
  for (let i = 7; i >= 0; i--) {
    const a = startOfWeek(); a.setDate(a.getDate() - 7 * i); const b = new Date(a); b.setDate(b.getDate() + 7);
    weeks.push({ lbl: a.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }), km: all.filter(s => s.start >= a && s.start < b).reduce((x, s) => x + s.dist, 0) / 1000 });
  }
  const mx = Math.max(1, ...weeks.map(w => w.km));
  const best5 = bestTime(all, 5000), best1 = bestTime(all, 1000);
  view.innerHTML = `
    <div class="row between"><h1>Historial</h1><label class="btn sm" style="margin:0;color:var(--text)">⇪ Importar GPX/TCX<input type="file" id="imp" accept=".gpx,.tcx,application/gpx+xml" multiple hidden></label></div>
    <div class="grid3" style="margin:12px 0">
      <div class="stat"><div class="v">${all.length}</div><div class="l">sesiones</div></div>
      <div class="stat"><div class="v">${(tot.d / 1000).toFixed(1)}</div><div class="l">km</div></div>
      <div class="stat"><div class="v">${fmtTime(tot.t)}</div><div class="l">tiempo</div></div>
    </div>
    <div class="card"><div class="row between"><h3>Km por semana</h3><span class="muted small">últimas 8</span></div>
      <div style="display:flex;align-items:flex-end;gap:6px;height:110px;margin-top:10px">${weeks.map(w => `<div style="flex:1;text-align:center"><div style="height:${Math.max(3, w.km / mx * 80)}px;background:var(--grad);border-radius:6px 6px 2px 2px;opacity:${w.km ? 1 : .25}"></div><div class="small muted" style="font-size:10px;margin-top:4px">${w.km ? w.km.toFixed(1) : ''}</div></div>`).join('')}</div></div>
    <div class="grid2"><div class="stat"><div class="v">${best1 ? fmtPace(best1) : '--'}</div><div class="l">mejor km</div></div><div class="stat"><div class="v">${best5 ? fmtTime(best5) : '--'}</div><div class="l">mejor 5 km</div></div></div>
    <h2>Sesiones</h2>
    ${all.length ? all.map(s => `<div class="card hist-item" data-id="${s.id}"><div class="thumb">${routeSvg(s.points)}</div>
      <div style="flex:1;min-width:0"><div class="muted small">${fmtDate(s.start)} · ${new Date(s.start).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}${s.imported ? ' · importada' : ''}${s.simulated ? ' · simulada' : ''}</div>
      <div style="font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(s.workout?.title || 'Carrera libre')}</div>
      <div class="small"><b>${fmtKm(s.dist)} km</b> · ${fmtTime(s.elapsed)} · ${fmtPace(s.avgPace)} /km</div></div></div>`).join('') : '<div class="empty">Aún no hay sesiones. ¡La primera es la más importante! 🏁</div>'}
  `;
  $$('.hist-item').forEach(c => c.onclick = () => go('detail', c.dataset.id));
  $('#imp').onchange = async e => {
    let n = 0;
    for (const f of e.target.files) {
      try { const s = parseTrackFile(await f.text(), f.name); s.kcal = Math.round((profile()?.weightKg || 75) * s.dist / 1000 * 1.03); await sessions.put(s); n++; }
      catch (err) { toast(`${f.name}: ${err.message}`); }
    }
    if (n) { toast(`${n} actividad(es) importada(s)`); renderHistory(); }
  };
}
function bestTime(all, m) {
  let best = 0;
  for (const s of all) {
    if (m === 1000) for (const sp of s.splits || []) { if (!best || sp.sec < best) best = sp.sec; }
    else if ((s.splits || []).length >= m / 1000) {
      const sp = s.splits; for (let i = 0; i + m / 1000 <= sp.length; i++) { const t = sp.slice(i, i + m / 1000).reduce((a, x) => a + x.sec, 0); if (!best || t < best) best = t; }
    }
  }
  return best;
}

async function renderDetail(id) {
  const s = await sessions.get(id);
  if (!s) return go('history');
  const maxSp = Math.max(...(s.splits || []).map(x => x.sec), 1), minSp = Math.min(...(s.splits || []).map(x => x.sec), maxSp);
  view.innerHTML = `
    <button class="btn sm ghost" id="back">← Historial</button>
    <div class="muted small" style="margin-top:8px">${fmtDate(s.start)} · ${new Date(s.start).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</div>
    <h1>${esc(s.workout?.title || 'Carrera libre')}</h1>
    <div class="mini-map" id="dmap"></div>
    <div class="grid3">
      <div class="stat"><div class="v">${fmtKm(s.dist)}</div><div class="l">km</div></div>
      <div class="stat"><div class="v">${fmtTime(s.elapsed)}</div><div class="l">tiempo</div></div>
      <div class="stat"><div class="v">${fmtPace(s.avgPace)}</div><div class="l">ritmo medio</div></div>
      <div class="stat"><div class="v">${s.kcal || '--'}</div><div class="l">kcal</div></div>
      <div class="stat"><div class="v">${s.elevGain ?? '--'}</div><div class="l">desnivel + (m)</div></div>
      <div class="stat"><div class="v">${s.avgHr || '--'}</div><div class="l">FC media${s.maxHr ? ' · máx ' + s.maxHr : ''}</div></div>
    </div>
    ${s.rpe ? `<div class="card small" style="margin-top:12px">Esfuerzo <b>${s.rpe}/10</b>${s.feel ? ' · ' + esc(s.feel) : ''}${s.pain ? ' · <span style="color:var(--pink)">con molestias</span>' : ''}${s.note ? `<div class="muted" style="margin-top:4px">“${esc(s.note)}”</div>` : ''}</div>` : ''}
    <h2>Parciales</h2>
    <div class="card"><table class="splits"><tr><th>Km</th><th>Ritmo</th><th style="width:40%"></th><th>Acum.</th>${s.splits?.some(x => x.hr) ? '<th>FC</th>' : ''}</tr>
      ${(s.splits || []).map(x => `<tr><td>${x.km}</td><td><b>${fmtPace(x.sec)}</b>${x.sec === minSp && s.splits.length > 1 ? ' ⚡' : ''}</td><td><div class="bar" style="width:${Math.max(15, (1 - (x.sec - minSp) / (maxSp - minSp + 1) * .7) * 100)}%"></div></td><td class="muted">${fmtTime(x.at)}</td>${s.splits.some(y => y.hr) ? `<td>${x.hr || ''}</td>` : ''}</tr>`).join('')}
      ${s.partial ? `<tr><td class="muted">${(s.partial.m / 1000).toFixed(2)}</td><td><b>${fmtPace(s.partial.sec / (s.partial.m / 1000))}</b></td><td></td><td class="muted">${fmtTime(s.elapsed)}</td></tr>` : ''}
      ${!(s.splits || []).length && !s.partial ? '<tr><td colspan="4" class="muted">Sin parciales</td></tr>' : ''}</table></div>
    <h2>Exportar</h2>
    <div class="grid2"><button class="btn" id="kml">🌍 Google Earth (KML)</button><button class="btn" id="gpx">⌁ GPX (Strava, Garmin…)</button></div>
    <p class="muted small">Abre el KML en Google Earth (escritorio, o earth.google.com → Proyectos → Importar archivo KML). Incluye la ruta, marcas por km y un recorrido animado en 3D.</p>
    <div class="row" style="margin-top:8px"><button class="btn sm" id="fbBtn">✎ Valorar sesión</button><button class="btn sm danger" id="del">🗑 Borrar</button></div>
  `;
  $('#back').onclick = () => go('history');
  const fname = `runnin-g_${isoDay(s.start)}_${fmtKm(s.dist)}km`;
  $('#kml').onclick = () => download(fname + '.kml', toKML(s), 'application/vnd.google-earth.kml+xml');
  $('#gpx').onclick = () => download(fname + '.gpx', toGPX(s), 'application/gpx+xml');
  $('#del').onclick = async () => { if (confirm('¿Borrar esta sesión?')) { await sessions.del(id); go('history'); } };
  $('#fbBtn').onclick = () => openFeedback(s.planId ? findWorkout(s.planId) : null, s);
  if (window.L && s.points?.length > 1) {
    const m = L.map('dmap', { zoomControl: false, attributionControl: false });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 }).addTo(m);
    const line = L.polyline(s.points.map(p => [p.lat, p.lon]), { color: '#c6ff3d', weight: 5 }).addTo(m);
    L.circleMarker([s.points[0].lat, s.points[0].lon], { radius: 7, color: '#070a14', weight: 3, fillColor: '#3dffa8', fillOpacity: 1 }).addTo(m);
    L.circleMarker([s.points.at(-1).lat, s.points.at(-1).lon], { radius: 7, color: '#070a14', weight: 3, fillColor: '#ff3d7f', fillOpacity: 1 }).addTo(m);
    m.fitBounds(line.getBounds(), { padding: [24, 24] });
  } else $('#dmap').innerHTML = `<div style="height:100%;display:grid;place-items:center;background:var(--card)">${routeSvg(s.points)}</div>`;
}

// ---------- COACH ----------
function renderCoach() {
  const chat = kv.get('chat') || [];
  const st = settings();
  view.innerHTML = `
    <h1>Coach <span class="grad-text">IA</span></h1>
    <p class="muted small">Cuéntame cómo te encuentras, por escrito o por voz. Analizo tus sesiones, te doy consejos y adapto el plan.${st.apiKey ? '' : ' <b>Modo local</b>: añade tu clave de Claude en ⚙ para un análisis completo.'}</p>
    <div class="seg" id="quick" style="margin:10px 0">${['Hoy estoy cansado', 'Me molesta la rodilla', '¿Qué como antes de correr?', 'Me ha resultado fácil'].map(q => `<button>${q}</button>`).join('')}</div>
    <div class="chat" id="chat">${chat.length ? chat.map(msgHtml).join('') : `<div class="msg bot">¡Hola${profile().name ? ' ' + esc(profile().name) : ''}! Soy tu entrenador. Estoy aquí para que llegues a tu meta sin lesionarte. ¿Cómo te encuentras hoy?</div>`}</div>
    <div class="chat-pad"></div>
    <div class="composer"><button class="icon-btn" id="mic" title="Hablar">🎙</button><textarea id="msg" placeholder="Escribe al coach…"></textarea><button class="icon-btn" id="send" style="background:var(--grad);color:#070a14;border:0">➤</button></div>`;
  const box = $('#chat');
  const scroll = () => window.scrollTo(0, document.body.scrollHeight);
  scroll();
  const send = async text => {
    text = text.trim(); if (!text) return;
    $('#msg').value = '';
    box.insertAdjacentHTML('beforeend', msgHtml({ role: 'user', content: text }) + '<div class="msg bot pulse" id="typing">…</div>'); scroll();
    try {
      const r = await askCoach(text);
      $('#typing').remove();
      box.insertAdjacentHTML('beforeend', msgHtml({ role: 'assistant', content: r.reply, adjustment: r.adjustment })); scroll();
      if (settings().speakReplies) speak(r.reply, { priority: true });
    } catch (e) { $('#typing').remove(); box.insertAdjacentHTML('beforeend', `<div class="msg sys">⚠ ${esc(e.message)}</div>`); }
  };
  $('#send').onclick = () => send($('#msg').value);
  $('#msg').onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send($('#msg').value); } };
  $$('#quick button').forEach(b => b.onclick = () => send(b.textContent));
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) $('#mic').onclick = () => toast('Tu navegador no admite dictado por voz (prueba Chrome o Safari).');
  else {
    let rec = null;
    $('#mic').onclick = () => {
      if (rec) { rec.stop(); return; }
      rec = new SR(); rec.lang = 'es-ES'; rec.interimResults = true; rec.continuous = false;
      $('#mic').classList.add('rec');
      let final = '';
      rec.onresult = e => { let t = ''; for (const r of e.results) { t += r[0].transcript; if (r.isFinal) final = t; } $('#msg').value = t; };
      rec.onend = () => { $('#mic').classList.remove('rec'); rec = null; if (final) send(final); };
      rec.onerror = e => toast('Micrófono: ' + e.error);
      rec.start();
    };
  }
}
function msgHtml(m) {
  if (m.role === 'user') return `<div class="msg user">${esc(m.content)}</div>`;
  return `<div class="msg bot">${esc(m.content)}</div>${m.adjustment ? `<div class="msg sys">⚙ ${esc(m.adjustment)}</div>` : ''}`;
}

// ---------- AJUSTES ----------
function openSettings() {
  const st = settings();
  const voices = spanishVoices();
  modal(`<div class="row between"><h1>Ajustes</h1><button class="icon-btn" id="mClose">✕</button></div>
    <button class="btn block" id="editProfile">👤 Editar perfil y objetivos</button>
    <h2>Entrenador por voz</h2>
    <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="sVoice" ${st.voice ? 'checked' : ''} style="width:auto"> Mensajes de voz durante la carrera</label>
    <label>Voz</label><select id="sVoiceName"><option value="">Automática</option>${voices.map(v => `<option ${st.voiceName === v.name ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select>
    <label>Ánimos periódicos cada</label><select id="sCheer">${[3, 5, 8, 10, 15].map(n => `<option value="${n}" ${st.cheerEvery === n ? 'selected' : ''}>${n} minutos</option>`).join('')}</select>
    <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="sSpeakReplies" ${st.speakReplies ? 'checked' : ''} style="width:auto"> Leer en voz alta las respuestas del coach</label>
    <button class="btn sm" id="testVoice" style="margin-top:8px">🔊 Probar voz</button>
    <h2>Coach IA (Claude)</h2>
    <label>Clave de API de Anthropic</label><input id="sKey" type="password" value="${esc(st.apiKey || '')}" placeholder="sk-ant-…">
    <label>Modelo</label><input id="sModel" value="${esc(st.model || 'claude-sonnet-5-5')}">
    <p class="muted small">La clave se guarda solo en este dispositivo y se envía directamente a la API de Anthropic. Sin clave funciona un coach local básico.</p>
    <h2>Datos</h2>
    <div class="grid2"><button class="btn sm" id="bExport">⇩ Copia de seguridad</button><label class="btn sm" style="margin:0;color:var(--text)">⇪ Restaurar<input type="file" id="bImport" accept=".json" hidden></label></div>
    <label style="display:flex;gap:8px;align-items:center;margin-top:16px"><input type="checkbox" id="sSim" ${st.simulate ? 'checked' : ''} style="width:auto"> Modo simulación (probar sin GPS real)</label>
    <button class="btn primary block" id="sSave" style="margin-top:16px">Guardar</button>
    <p class="muted small" style="text-align:center;margin-top:16px">Runnin-G v1.0 · tus datos nunca salen de tu dispositivo</p>`, el => {
    $('#mClose', el).onclick = closeModal;
    $('#editProfile', el).onclick = () => { closeModal(); renderOnboarding(true); };
    $('#testVoice', el).onclick = () => { unlockAudio(); kv.set('settings', { ...settings(), voice: true, voiceName: $('#sVoiceName', el).value }); speak('Kilómetro 3. Tiempo 18 minutos 20 segundos. ¡Vas genial, sigue así!', { priority: true }); };
    $('#bExport', el).onclick = async () => download(`runnin-g-backup-${isoDay(Date.now())}.json`, JSON.stringify(await exportBackup()), 'application/json');
    $('#bImport', el).onchange = async e => { try { await importBackup(JSON.parse(await e.target.files[0].text())); toast('Datos restaurados'); closeModal(); go('today'); } catch (err) { toast(err.message); } };
    $('#sSave', el).onclick = () => {
      kv.set('settings', { ...settings(), voice: $('#sVoice', el).checked, voiceName: $('#sVoiceName', el).value, cheerEvery: +$('#sCheer', el).value,
        speakReplies: $('#sSpeakReplies', el).checked, apiKey: $('#sKey', el).value.trim(), model: $('#sModel', el).value.trim() || 'claude-sonnet-5-5', simulate: $('#sSim', el).checked });
      closeModal(); toast('Ajustes guardados'); if (!tracker) go(tab === 'detail' ? 'history' : tab);
    };
  });
}

// ---------- Arranque ----------
function boot() {
  if (!profile() || !plan()) { renderOnboarding(); return; }
  const notes = rollWeek(profile());
  const pending = kv.get('activeRun');
  if (pending) {
    kv.del('activeRun');
    if (pending.dist > 100 && confirm(`Hay una carrera sin terminar (${fmtKm(pending.dist)} km). ¿Guardarla?`))
      sessions.put({ id: uid(), ...pending, planId: pending.workout?.id }).then(() => toast('Carrera recuperada'));
  }
  go('today');
  if (notes?.length) setTimeout(() => toast(`Nueva semana: ${notes.at(-1)}`, 6000), 600);
}
boot();

if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
window.addEventListener('beforeunload', e => { if (tracker && tracker.state !== 'stopped') { e.preventDefault(); e.returnValue = ''; } });
