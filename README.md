# Hydra Convert

Conversor de vídeo, audio e imagen **100% local**: todo se procesa en el navegador con
WebCodecs, Canvas 2D y WebAudio. Sin backend, sin subidas, sin descargas en runtime.

## Uso

1. Arrastra archivos (o haz clic en la zona de subida). Se aceptan varios a la vez.
2. Ajusta las opciones de salida (panel contextual por tipo: imagen, audio o vídeo).
3. Pulsa **Convertir** en un archivo o **Convertir todo** para la cola completa.
4. Descarga cada resultado con su botón **Descargar**.

Puedes cancelar una conversión en curso, reintentar errores y vaciar la cola.
Los archivos nunca salen de tu dispositivo.

## Formatos

| Tipo   | Entrada                                        | Salida                                              |
| ------ | ---------------------------------------------- | --------------------------------------------------- |
| Imagen | png, jpg, jpeg, webp, gif, bmp, svg, avif, ico | png, jpeg (jpg), webp (+resize, calidad)           |
| Audio  | mp3, wav, ogg, webm, m4a, aac, flac, mp4       | wav (PCM), webm (Opus), m4a (AAC)                   |
| Vídeo  | mp4, webm, mov, m4a, ogv                       | mp4 (H264+AAC), webm, gif, m4a*, wav, png, jpg      |

\* La plataforma web no tiene codificador MP3: la opción «MP3» entrega `.m4a` (AAC),
reproducible en todos los reproductores.

## Arquitectura local

- `src/converters/image.ts` — `createImageBitmap` + canvas + `toBlob`.
- `src/converters/audio.ts` — `decodeAudioData` + resample con `OfflineAudioContext`;
  WAV manual, AAC vía `AudioEncoder` + `mp4-muxer`, WebM vía `MediaRecorder`.
- `src/converters/video.ts` — MP4 con `VideoEncoder` (H.264) + AAC + `mp4-muxer`;
  WebM con `canvas.captureStream` + `MediaRecorder`; GIF con encoder propio inline;
  audio/frame extraídos con los motores anteriores.
- `src/lib/store.ts` — cola de jobs (zustand, solo metadatos serializables).
- `src/lib/detect.ts` — detección de tipo por MIME/extensión + probes de metadatos.
- `src/components/` + `src/App.tsx` — UI: Dropzone, OptionsPanel, Queue, Header.
  Los `File` originales viven en un `Map` en memoria en `App` (nunca se suben);
  las descargas usan object URL efímeras revocadas por `triggerDownload`.
- Cero `fetch(http)` en runtime: todo está bundleado con Vite.

## Dev / Build / Test

```bash
# Desarrollo (puerto 5174)
npm run dev --workspace=apps/hydra-convert

# Tipos + build
npm run build --workspace=apps/hydra-convert

# Preview del build
npx vite preview --port 5174 --workspace=apps/hydra-convert

# Smoke E2E (Chrome real, 0 console errors)
node apps/hydra-convert/scripts/test-convert.mjs
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
