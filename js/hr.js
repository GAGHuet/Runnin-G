// Pulsómetro Bluetooth (cualquier banda o reloj que emita el servicio estándar Heart Rate:
// Polar H10/H9, Garmin HRM, Wahoo TICKR, Coros, muchos relojes en modo "emitir FC").
let device, listeners = new Set();
export const hrState = { connected: false, bpm: null, name: '' };

export function onHr(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const emit = () => listeners.forEach(f => f(hrState));

export const hrSupported = () => 'bluetooth' in navigator;

export async function connectHr() {
  if (!hrSupported()) throw new Error('Tu navegador no soporta Bluetooth web (usa Chrome en Android o escritorio).');
  device = await navigator.bluetooth.requestDevice({ filters: [{ services: ['heart_rate'] }] });
  device.addEventListener('gattserverdisconnected', () => { hrState.connected = false; hrState.bpm = null; emit(); });
  const server = await device.gatt.connect();
  const svc = await server.getPrimaryService('heart_rate');
  const ch = await svc.getCharacteristic('heart_rate_measurement');
  ch.addEventListener('characteristicvaluechanged', e => {
    const v = e.target.value, flags = v.getUint8(0);
    hrState.bpm = flags & 1 ? v.getUint16(1, true) : v.getUint8(1);
    emit();
  });
  await ch.startNotifications();
  Object.assign(hrState, { connected: true, name: device.name || 'Pulsómetro' });
  emit();
}
export function disconnectHr() { try { device?.gatt?.disconnect(); } catch {} }
