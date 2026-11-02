// Almacenamiento local: ajustes/perfil/plan en localStorage, sesiones (con trazas GPS) en IndexedDB.
const LS = 'running-g:';

export const kv = {
  get(key, def = null) {
    try { const v = localStorage.getItem(LS + key); return v == null ? def : JSON.parse(v); } catch { return def; }
  },
  set(key, val) { try { localStorage.setItem(LS + key, JSON.stringify(val)); } catch (e) { console.warn(e); } },
  del(key) { try { localStorage.removeItem(LS + key); } catch {} },
};

let dbp;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open('runnin-g', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('sessions')) d.createObjectStore('sessions', { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
function tx(mode, fn) {
  return db().then(d => new Promise((res, rej) => {
    const t = d.transaction('sessions', mode);
    const s = t.objectStore('sessions');
    const out = fn(s);
    t.oncomplete = () => res(out && 'result' in out ? out.result : out);
    t.onerror = () => rej(t.error);
  }));
}
export const sessions = {
  put: s => tx('readwrite', st => st.put(s)),
  get: id => tx('readonly', st => st.get(id)),
  del: id => tx('readwrite', st => st.delete(id)),
  async all() {
    const list = await tx('readonly', st => st.getAll());
    return (list || []).sort((a, b) => b.start - a.start);
  },
};

export async function exportBackup() {
  return {
    app: 'Runnin-G', version: 1, exportedAt: new Date().toISOString(),
    profile: kv.get('profile'), plan: kv.get('plan'), settings: kv.get('settings'),
    chat: kv.get('chat'), feedback: kv.get('feedback'), sessions: await sessions.all(),
  };
}
export async function importBackup(data) {
  if (!data || data.app !== 'Runnin-G') throw new Error('Archivo no válido');
  for (const k of ['profile', 'plan', 'settings', 'chat', 'feedback']) if (data[k] != null) kv.set(k, data[k]);
  for (const s of data.sessions || []) await sessions.put(s);
}
