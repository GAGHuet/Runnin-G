// Coach IA: analiza mensajes escritos o hablados y adapta el plan.
// Con clave de API de Claude usa el modelo; sin ella, un coach local basado en reglas.
import { kv, sessions } from './store.js';
import { buildWeek, phaseName, GOALS, LEVELS, hrMax, applyAdjustment, isDeload } from './plan.js';
import { fmtPace, fmtTime, DAYS } from './util.js';

const SYSTEM = `Eres el entrenador personal de Runnin-G: un equipo de especialistas (entrenador de atletismo titulado, preparador físico y fisioterapeuta deportivo) condensado en una voz cercana, motivadora y honesta. Hablas en español de España, tuteas, frases claras y breves.
Principios: progresión gradual (no más de un 10 % de aumento semanal), semana de descarga cada cuatro, 80 % del volumen suave, fuerza dos veces por semana, el descanso también es entrenamiento. Eres exigente pero prudente: ante dolor agudo, dolor que cambia la forma de correr, mareos, dolor torácico o molestias que duran más de 3 días, recomiendas parar y consultar a un profesional sanitario. No diagnosticas.
Responde en 2-6 frases con consejos concretos y accionables (técnica, ritmo, recuperación, nutrición básica, sueño, fuerza), basados en los datos del usuario que se te dan.
Si, por lo que cuenta el usuario, conviene cambiar el plan, añade AL FINAL una sola etiqueta exactamente así:
<ajuste>{"stageDelta": -1|0|1, "intensity": 0.8-1.1, "reason": "motivo breve"}</ajuste>
stageDelta mueve el nivel de progresión; intensity multiplica la duración de las sesiones (1 = sin cambio). Úsala solo cuando esté justificado.`;

export async function buildContext() {
  const p = kv.get('profile') || {}, plan = kv.get('plan');
  const fb = kv.get('feedback') || {};
  const recent = (await sessions.all()).slice(0, 8);
  const lines = [];
  lines.push(`PERFIL: ${p.name || 'Usuario'}, ${p.age} años, ${p.sex === 'f' ? 'mujer' : p.sex === 'm' ? 'hombre' : 'sexo no indicado'}, ${p.weightKg} kg, ${p.heightCm} cm. Nivel: ${LEVELS[p.level]}. Objetivo: ${GOALS[p.goal]}. ${p.runDays} días de carrera y ${p.strengthDays} de fuerza por semana. FC máx estimada ${hrMax(p)}.${p.injuries ? ' Lesiones/limitaciones: ' + p.injuries : ''}${p.notes ? ' Notas: ' + p.notes : ''}`);
  if (plan) {
    lines.push(`PLAN: semana ${plan.weekNo}, ${phaseName(plan.stage)} (escalón ${plan.stage}${isDeload(plan.stage) ? ', descarga' : ''}), factor de carga ${plan.intensity}.`);
    const week = buildWeek(plan, p);
    lines.push('ESTA SEMANA: ' + week.map(d => `${DAYS[d.day]}: ${d.items.length ? d.items.map(w => `${w.title}${fb[w.id]?.completed ? ` [hecho, RPE ${fb[w.id].rpe}${fb[w.id].pain ? ', con molestias' : ''}]` : ''}`).join(' + ') : 'descanso'}`).join('; '));
    lines.push('HISTORIAL DE AJUSTES: ' + plan.log.slice(-5).map(l => l.text).join(' | '));
  }
  if (recent.length) lines.push('ÚLTIMAS SESIONES: ' + recent.map(s => `${new Date(s.start).toLocaleDateString('es-ES')}: ${(s.dist / 1000).toFixed(2)} km en ${fmtTime(s.elapsed)} (${fmtPace(s.avgPace)}/km${s.avgHr ? `, FC media ${s.avgHr}` : ''}${s.rpe ? `, RPE ${s.rpe}` : ''}${s.note ? `, nota: "${s.note}"` : ''})`).join('; '));
  lines.push(`FECHA: ${new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}`);
  return lines.join('\n');
}

export async function askCoach(text) {
  const chat = kv.get('chat') || [];
  const s = kv.get('settings') || {};
  let reply, adjustment = null;
  if (s.apiKey) {
    const ctx = await buildContext();
    const history = chat.slice(-10).filter(m => m.role === 'user' || m.role === 'assistant').map(m => ({ role: m.role, content: m.content }));
    // la API exige empezar por "user"
    while (history.length && history[0].role !== 'user') history.shift();
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json', 'x-api-key': s.apiKey, 'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: s.model || 'claude-sonnet-5-5', max_tokens: 700,
        system: `${SYSTEM}\n\nDATOS ACTUALES DEL USUARIO:\n${ctx}`,
        messages: [...history, { role: 'user', content: text }],
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(res.status === 401 ? 'Clave de API no válida' : `Error de la IA (${res.status}): ${err.slice(0, 160)}`);
    }
    const data = await res.json();
    reply = data.content.filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
  } else {
    reply = localCoach(text);
  }
  const m = reply.match(/<ajuste>([\s\S]*?)<\/ajuste>/);
  if (m) {
    reply = reply.replace(m[0], '').trim();
    try { adjustment = applyAdjustment(JSON.parse(m[1])); } catch {}
  }
  chat.push({ role: 'user', content: text, ts: Date.now() }, { role: 'assistant', content: reply, ts: Date.now(), adjustment });
  kv.set('chat', chat.slice(-60));
  return { reply, adjustment };
}

// Coach local (sin conexión / sin clave): reglas sencillas pero útiles
function localCoach(t) {
  const s = t.toLowerCase();
  const has = (...w) => w.some(x => s.includes(x));
  if (has('pecho', 'mareo', 'desmay', 'palpitac'))
    return 'Eso es importante: si notas dolor en el pecho, mareos o palpitaciones, para de inmediato y consulta con un médico antes de volver a entrenar. Tu salud va primero.';
  if (has('dolor', 'lesi', 'molest', 'rodilla', 'tobillo', 'gemelo', 'espinilla', 'cintilla', 'fascitis', 'aquiles'))
    return 'Gracias por contármelo. Bajo la carga de las próximas sesiones y retrocedo un escalón para que no vaya a más. Si el dolor es punzante, te hace cojear o dura más de 3 días, consulta a un fisioterapeuta. Mientras tanto, prioriza la fuerza suave (puente de glúteo, elevación de talones lenta) y evita las cuestas.\n<ajuste>{"stageDelta":-1,"intensity":0.9,"reason":"molestias"}</ajuste>';
  if (has('cansad', 'agotad', 'reventad', 'sin fuerza', 'duro', 'no puedo', 'dormido mal', 'estrés', 'estres'))
    return 'Te escucho. El cansancio acumulado es una señal, no un fracaso. Esta semana suavizo un 10 % la carga. Duerme 7-8 h, hidrátate y asegúrate de comer hidratos y proteína tras entrenar. Mejor una sesión suave terminada que una dura a medias.\n<ajuste>{"stageDelta":0,"intensity":0.9,"reason":"fatiga"}</ajuste>';
  if (has('fácil', 'facil', 'genial', 'muy bien', 'sobrado', 'me sobra', 'poco', 'quiero más', 'quiero mas'))
    return '¡Me encanta oír eso! Tu cuerpo se está adaptando. Subo un escalón tu plan, sin pasarnos: la clave es progresar sin lesionarse. Mantén los rodajes realmente suaves; la velocidad llegará sola.\n<ajuste>{"stageDelta":1,"intensity":1,"reason":"buenas sensaciones"}</ajuste>';
  if (has('comer', 'comida', 'dieta', 'nutri', 'desayun'))
    return 'Para sesiones de menos de una hora no necesitas nada especial: come algo ligero 1-2 h antes (tostada, plátano) y bebe agua. Después, combina hidratos y proteína en la hora siguiente (yogur con fruta, bocadillo de pavo). Hidratación: un vaso de agua al despertar y antes de salir.';
  if (has('ritmo', 'velocidad', 'rápido', 'rapido', 'lento'))
    return 'En la mayoría de tus sesiones el ritmo correcto es el que te permite hablar con frases completas. Correr lento construye la base aeróbica; la velocidad la trabajamos en las sesiones de calidad. Si llevas pulsómetro, mantente en zona 2 en los rodajes.';
  if (has('fuerza', 'gimnasio', 'pesas', 'músculo', 'musculo'))
    return 'La fuerza es tu seguro anti-lesiones y te hará más eficiente. Haz los circuitos del plan con técnica perfecta; cuando completes todas las vueltas con facilidad, el plan subirá repeticiones. Prioriza glúteos, gemelos y core.';
  if (has('motiv', 'pereza', 'ganas', 'no me apetece'))
    return 'Truco de entrenador: comprométete solo con ponerte las zapatillas y salir 10 minutos. Casi siempre terminarás la sesión. Y recuerda por qué empezaste: cada salida suma, y la constancia gana a la intensidad.';
  return 'Anotado. Sigo tu evolución con cada sesión y ajusto el plan según tus sensaciones y tu esfuerzo percibido. Cuéntame cómo te encuentras (cansancio, molestias, ánimo) y te daré consejos más concretos. Para un análisis más completo, añade tu clave de Claude en Ajustes.';
}
