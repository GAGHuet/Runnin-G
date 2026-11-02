// Exportación a Google Earth (KML) y GPX; importación GPX/TCX desde relojes y otras apps.
import { haversine, fmtTime, fmtPace, uid } from './util.js';

const x = s => String(s ?? '').replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

export function toKML(s) {
  const pts = s.points || [];
  const coords = pts.map(p => `${p.lon},${p.lat},${p.alt ?? 0}`).join(' ');
  const name = `Runnin-G · ${new Date(s.start).toLocaleString('es-ES')}`;
  // marcas por km
  const marks = []; let acc = 0, next = 1000;
  for (let i = 1; i < pts.length; i++) {
    acc += haversine(pts[i - 1], pts[i]);
    if (acc >= next) {
      const sp = s.splits?.[next / 1000 - 1];
      marks.push(`<Placemark><name>Km ${next / 1000}</name><description>${sp ? `Parcial ${fmtPace(sp.sec)} /km · ${fmtTime(sp.at)}` : ''}</description><styleUrl>#km</styleUrl><Point><coordinates>${pts[i].lon},${pts[i].lat},0</coordinates></Point></Placemark>`);
      next += 1000;
    }
  }
  const tour = pts.length > 1 ? `<gx:Tour><name>Recorrido animado</name><gx:Playlist>${pts.filter((_, i) => i % Math.max(1, Math.floor(pts.length / 60)) === 0).map(p =>
    `<gx:FlyTo><gx:duration>1.5</gx:duration><gx:flyToMode>smooth</gx:flyToMode><LookAt><longitude>${p.lon}</longitude><latitude>${p.lat}</latitude><altitude>0</altitude><range>400</range><tilt>60</tilt><heading>0</heading></LookAt></gx:FlyTo>`).join('')}</gx:Playlist></gx:Tour>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">
<Document>
<name>${x(name)}</name>
<description>${x(`${(s.dist / 1000).toFixed(2)} km · ${fmtTime(s.elapsed)} · ritmo medio ${fmtPace(s.avgPace)} /km${s.workout ? ' · ' + s.workout.title : ''}`)}</description>
<Style id="route"><LineStyle><color>ff3dffc6</color><width>5</width></LineStyle></Style>
<Style id="km"><IconStyle><scale>0.8</scale><Icon><href>http://maps.google.com/mapfiles/kml/paddle/orange-circle.png</href></Icon></IconStyle></Style>
<Style id="start"><IconStyle><Icon><href>http://maps.google.com/mapfiles/kml/paddle/go.png</href></Icon></IconStyle></Style>
<Style id="end"><IconStyle><Icon><href>http://maps.google.com/mapfiles/kml/paddle/red-square.png</href></Icon></IconStyle></Style>
<Placemark><name>Ruta</name><styleUrl>#route</styleUrl><LineString><tessellate>1</tessellate><altitudeMode>clampToGround</altitudeMode><coordinates>${coords}</coordinates></LineString></Placemark>
${pts.length ? `<Placemark><name>Salida</name><styleUrl>#start</styleUrl><Point><coordinates>${pts[0].lon},${pts[0].lat},0</coordinates></Point></Placemark>
<Placemark><name>Llegada</name><styleUrl>#end</styleUrl><Point><coordinates>${pts.at(-1).lon},${pts.at(-1).lat},0</coordinates></Point></Placemark>` : ''}
<Folder><name>Kilómetros</name>${marks.join('\n')}</Folder>
${tour}
</Document>
</kml>`;
}

export function toGPX(s) {
  const pts = (s.points || []).map(p => `<trkpt lat="${p.lat}" lon="${p.lon}">${p.alt != null ? `<ele>${p.alt}</ele>` : ''}<time>${new Date(p.t).toISOString()}</time>${p.hr ? `<extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>${p.hr}</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions>` : ''}</trkpt>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Runnin-G" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
<metadata><name>Runnin-G ${new Date(s.start).toISOString()}</name><time>${new Date(s.start).toISOString()}</time></metadata>
<trk><name>${x(s.workout?.title || 'Carrera')}</name><type>running</type><trkseg>
${pts}
</trkseg></trk></gpx>`;
}

// Importación: GPX (Garmin, Coros, Suunto, Polar, Strava…) y TCX (Garmin)
export function parseTrackFile(text, filename = '') {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('No se pudo leer el archivo');
  let raw = [];
  const tag = (el, name) => el.getElementsByTagNameNS('*', name)[0]?.textContent;
  if (/\.tcx$/i.test(filename) || doc.getElementsByTagNameNS('*', 'Trackpoint').length) {
    for (const tp of doc.getElementsByTagNameNS('*', 'Trackpoint')) {
      const lat = tag(tp, 'LatitudeDegrees'), lon = tag(tp, 'LongitudeDegrees');
      if (lat == null) continue;
      raw.push({ lat: +lat, lon: +lon, t: Date.parse(tag(tp, 'Time')), alt: tag(tp, 'AltitudeMeters') != null ? +tag(tp, 'AltitudeMeters') : null, hr: tag(tp, 'Value') ? +tag(tp, 'Value') : undefined });
    }
  } else {
    for (const tp of doc.getElementsByTagNameNS('*', 'trkpt')) {
      raw.push({ lat: +tp.getAttribute('lat'), lon: +tp.getAttribute('lon'), t: Date.parse(tag(tp, 'time')), alt: tag(tp, 'ele') != null ? +tag(tp, 'ele') : null, hr: tag(tp, 'hr') ? +tag(tp, 'hr') : undefined });
    }
  }
  raw = raw.filter(p => isFinite(p.lat) && isFinite(p.lon));
  if (raw.length < 2) throw new Error('El archivo no contiene una ruta');
  if (!raw.every(p => isFinite(p.t))) { const t0 = Date.now() - raw.length * 1000; raw.forEach((p, i) => p.t = t0 + i * 1000); }
  return buildSessionFromPoints(raw);
}

export function buildSessionFromPoints(points) {
  let dist = 0, moving = 0, lastKm = 0, lastKmT = 0, gain = 0; const splits = [];
  for (let i = 1; i < points.length; i++) {
    const d = haversine(points[i - 1], points[i]), dt = (points[i].t - points[i - 1].t) / 1000;
    if (dt <= 0) continue;
    if (d / dt > 0.6 && dt < 30) moving += dt; // pausas excluidas
    dist += d;
    if (points[i].alt != null && points[i - 1].alt != null && points[i].alt > points[i - 1].alt) gain += points[i].alt - points[i - 1].alt;
    if (dist - lastKm >= 1000) { splits.push({ km: splits.length + 1, sec: Math.round(moving - lastKmT), at: Math.round(moving) }); lastKm += 1000; lastKmT = moving; }
  }
  const hrs = points.map(p => p.hr).filter(Boolean);
  return {
    id: uid(), start: points[0].t, end: points.at(-1).t, elapsed: Math.round(moving), dist: Math.round(dist),
    avgPace: dist > 50 ? moving / (dist / 1000) : 0, kcal: 0, elevGain: Math.round(gain), splits,
    partial: dist - lastKm > 50 ? { m: Math.round(dist - lastKm), sec: Math.round(moving - lastKmT) } : null,
    avgHr: hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null, maxHr: hrs.length ? Math.max(...hrs) : null,
    points, imported: true,
  };
}
