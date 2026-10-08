# Hydra Convert

Conversor de vídeo, audio e imagen **100% local**: todo se procesa en el navegador con
WebCodecs, Canvas 2D y WebAudio. Sin backend, sin subidas, sin descargas en runtime.

**Estado:** ✅ Desplegado en Cloudflare Pages — repo `https://github.com/juanpimg/HydraConverter.git` (último deploy `6b3737e`, versión `v1.0.2`).
**Handoff de sesión:** ver `HANDOFF.md` (dónde está el código, decisiones técnicas y deuda).

## Uso

1. Arrastra archivos (o haz clic en la zona de subida). Se aceptan varios a la vez.
2. Ajusta las opciones de salida (panel contextual por tipo: imagen, audio o vídeo).
3. Pulsa **Convertir** en un archivo o **Convertir todo** para la cola completa.
4. Descarga individualmente con **Descargar** o en lote con **Descargar lote (.zip)**.

Puedes cancelar una conversión en curso en cualquier momento (cancelación cooperativa inmediata con `AbortSignal`), reintentar errores y vaciar la cola.
Los archivos nunca salen de tu dispositivo.

## Formatos

| Tipo   | Entrada                                        | Salida                                                                 |
| ------ | ---------------------------------------------- | ---------------------------------------------------------------------- |
| Imagen | png, jpg, jpeg, webp, gif, bmp, svg, avif, ico | png, jpeg (jpg), webp (+resize, calidad)                               |
| Audio  | mp3, wav, ogg, webm, m4a, aac, flac, mp4       | wav (PCM 16-bit), webm (Opus), m4a (AAC u Opus según navegador)        |
| Vídeo  | mp4, webm, mov, m4a, ogv                       | mp4 (H.264+AAC o VP9+Opus), webm (VP8/VP9+Opus), gif, m4a*, wav, png, jpg |

\* La plataforma web no tiene codificador MP3: la opción «MP3» entrega `.m4a` (AAC u Opus),
reproducible en todos los reproductores.

**Los códecs se eligen con una sonda real, no con `isConfigSupported` a secas**
(que miente en Chrome y Firefox: dice `true` y luego la codificación real falla):

- **Chrome/Edge:** MP4 con **H.264** + audio **AAC** (si la plataforma lo expone) u **Opus**.
- **Firefox:** no puede codificar H.264 ni AAC → MP4 con **VP9 + Opus** (mismo contenedor,
  compatible con Chrome/Firefox/Edge).
- **Safari/iOS:** sin verificar (pendiente en deuda).

Si ningún encoder de vídeo inicializa, el job muestra el error con botón **«Probar como WebM»**.

## Arquitectura local

- `src/converters/image.ts` — `createImageBitmap` + canvas + `toBlob`.
- `src/converters/audio.ts` — `decodeAudioData` + resample con `OfflineAudioContext`;
  WAV manual (`src/utils/wav-encoder.ts`), AAC/Opus vía `AudioEncoder` + `mp4-muxer`,
  WebM vía `MediaRecorder`.
- `src/converters/video.ts` — MP4 con `VideoEncoder` (H.264 o VP9, elegido por sonda con
  frame real) + AAC/Opus + `mp4-muxer`; recuperación única si el encoder muere a mitad;
  WebM con `canvas.captureStream` + `MediaRecorder`; GIF con encoder LZW propio inline;
  audio/frame extraídos con los motores anteriores.
- `src/lib/store.ts` — cola de jobs (zustand, solo metadatos serializables).
- `src/lib/detect.ts` — detección de tipo por MIME/extensión + probes de metadatos.
- `src/components/` + `src/App.tsx` — UI: Dropzone, OptionsPanel, Queue, Header.
  Los `File` originales viven en un `Map` en memoria en `App` (nunca se suben);
  las descargas usan object URL efímeras revocadas por `triggerDownload`.
- Service worker (`public/sw.js`): **network-first** para navegaciones y cache-first para
  `/assets/*` — evita servir una versión vieja de la app tras cada despliegue.
- Cero `fetch(http)` en runtime: todo está bundleado con Vite.

## Dev / Build / Test

```bash
# Desarrollo (puerto 5174)
npm run dev --workspace=apps/hydra-convert

# Tipos + build
npm run build --workspace=apps/hydra-convert

# Suites de prueba
npm run test:convert:unit      # Vitest: utilidades ZIP, formatBytes, detect
npm run test:convert:cancel-zip# E2E: Cancelación cooperativa <50ms y descarga ZIP
npm run test:convert           # Chrome smoke: imagen + audio + móvil 390px, 0 console errors
npm run test:convert:video     # Chrome matriz de vídeo: 7 casos (1080p30/60, vertical, impar, mov, sin audio, 480p/24)
npm run test:convert:firefox   # Firefox real: 6 casos (mp4, webm, wav, m4a, webp)

# ⚠️ Las suites de navegador deben correrse EN SERIE (Chrome headless SwiftShader se mata en paralelo).
```

## Deploy en Cloudflare Pages

Repo independiente listo para conectar: `https://github.com/juanpimg/HydraConverter.git`

- **Framework preset:** Vite
- **Build command:** `npm run build`
- **Build output directory:** `dist`
- **Node version:** `20.18.0` (vía `.node-version`)
- SPA fallback incluido en `public/_redirects` (`/* /index.html 200`)
- Cabeceras y caché en `public/_headers`
- Sin variables de entorno ni backend: 100% estático.

**Flujo de trabajo:** se desarrolla en el monorepo (`apps/hydra-convert/`) y se sincroniza
al repo de deploy con `npm run sync:convert` (desde la raíz del monorepo). Luego
`git add -A && git commit && git push origin main` en `../HydraConverter` — Cloudflare
redespliega automáticamente.

> Tras un despliegue, si el navegador muestra una versión vieja, hacer **un hard-refresh
> (Ctrl+Mayús+R)** para expulsar el service worker anterior.

## Limitaciones conocidas

- **MP3 de salida** no existe como códec web: se entrega `.m4a` (AAC u Opus).
- **GIF:** máximo 5 s, 60 frames, 480 px de ancho; paleta global 3-3-2 sin dithering.
- **Archivos grandes:** se procesan en memoria (OPFS está en deuda).
- **Firefox headless:** las descargas no funcionan vía WebDriver BiDi (limitación del test,
  no de la app; el contenido se verifica interceptando el blob).
