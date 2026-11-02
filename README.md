# Runnin-G 🏃‍♂️

Entrenador personal de running: GPS, rutas para Google Earth, entrenador por voz, planes progresivos que se adaptan a ti y coach con IA.

## Arrancar en local

Necesita un servidor local (los navegadores no permiten GPS ni módulos JS abriendo el archivo con doble clic).

- **Windows:** doble clic en `iniciar.bat`
- **Mac / Linux:** `./iniciar.sh`
- O a mano, con Python instalado: `python -m http.server 8080` dentro de esta carpeta

Después abre **http://localhost:8080** en Chrome, Edge o Safari.

### En el móvil (para salir a correr)
El GPS del móvil solo funciona si la web va por **HTTPS**. Opciones sencillas y gratuitas:
1. **Netlify Drop** (https://app.netlify.com/drop): arrastra la carpeta `runnin-g` y te da una URL https al momento.
2. **GitHub Pages**: sube la carpeta a un repositorio y activa Pages.

Abre la URL en el móvil y usa **"Añadir a pantalla de inicio"**: se instala como una app con su icono y funciona sin conexión. Tus datos se guardan solo en tu móvil.

> Consejo: durante la carrera deja la app en primer plano (mantiene la pantalla encendida). Los navegadores limitan el GPS con la pantalla apagada; para seguimiento en segundo plano, el siguiente paso es empaquetarla como app nativa con Capacitor.

Para probar en el ordenador sin moverte: ⚙ Ajustes → **Modo simulación**.

## Qué hace

| Área | Funciones |
|---|---|
| Carrera | Distancia, tiempo, ritmo actual/medio, km en curso, último km, parciales por km, kcal, desnivel, pulso. Pausa, mapa en vivo, pantalla siempre encendida, recuperación si se cierra la app. |
| Voz | Cada 1000 m: km, tiempo, ritmo del último km y medio, pulso, comparación con el km anterior. Ánimos al detectar cambios de ritmo, pulso alto en sesiones suaves, mitad de sesión, nuevo récord, y ánimo + dato motivador cada X minutos (configurable). Pitidos y avisos en cada cambio de bloque. |
| Plan | 4 niveles de partida, 4 metas (regularidad + forma y fuerza, 5K, 10K, media). Fases: correr/caminar → carrera continua → base aeróbica → desarrollo. Progresión ~7 %/semana, descarga cada 4 semanas, 80/20 suave/calidad, fuerza 2×/semana progresiva. Arranque prudente según edad, IMC y lesiones. |
| Adaptación | Tras cada sesión: esfuerzo (RPE 1-10), sensaciones, molestias. Cada semana decide avanzar, repetir, saltar o retroceder. Sesión muy dura o con dolor: baja la carga al momento. |
| Coach IA | Chat por texto o dictado por voz; lee las respuestas en voz alta. Con clave de Claude analiza tu perfil, plan y sesiones y puede ajustar el plan. Sin clave, un coach local con reglas. |
| Google Earth | Exporta KML con la ruta, marcas por km, salida/llegada y un recorrido animado 3D. También GPX. |
| Relojes | Pulsómetro Bluetooth en directo (Polar, Garmin HRM, Wahoo, relojes en modo "emitir FC"; Chrome Android/escritorio). Importa GPX/TCX exportados de Garmin, Coros, Suunto, Polar, Strava… |
| Datos | Todo en el dispositivo (IndexedDB). Copia de seguridad y restauración en JSON. |

## Arquitectura
PWA sin servidor ni dependencias de compilación: HTML + CSS + módulos JS. Leaflet para el mapa (teselas CARTO/OSM).

```
index.html, css/app.css, manifest.webmanifest, sw.js (offline)
js/app.js      interfaz y navegación
js/tracker.js  GPS, filtrado, parciales, bloques, simulador
js/coach.js    voz del entrenador y lógica de ánimos
js/plan.js     motor de entrenamiento y adaptación
js/ai.js       coach IA (API de Claude) + coach local
js/export.js   KML/GPX, importación GPX/TCX
js/hr.js       pulsómetro Bluetooth
js/store.js    almacenamiento local
```

## Próximos pasos propuestos
App nativa (Capacitor) para GPS en segundo plano y notificaciones · sincronización con Garmin Connect / Strava / Apple Health (requiere un pequeño servidor para OAuth) · lectura de archivos .FIT · audio con la música en segundo plano.

*Aviso: Runnin-G no sustituye el consejo médico. Si tienes dudas sobre tu salud, consulta antes de empezar.*
