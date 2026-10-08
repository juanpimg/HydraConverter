# HYDRA-CONVERT — Plan (✅ COMPLETADO)

> Estado final y decisiones: ver `HANDOFF.md`. Este archivo conserva el plan original y las
> desviaciones respecto a él, para trazabilidad.

## Resultado final

- Convertidor vídeo/audio/imagen **100% local** (WebCodecs + Canvas + WebAudio + `mp4-muxer`),
  sin backend, sin CDN en runtime, offline tras la primera carga.
- **Desplegado:** GitHub `juanpimg/HydraConverter` + Cloudflare Pages (auto-deploy en `main`).
- **Verificación:** build verde + 3 suites E2E reales (Chrome smoke, Chrome matriz de vídeo 7/7,
  Firefox E2E 6/6) con 0 errores de consola. Contenido MP4 verificado con `ffprobe`.

## Alcance entregado

| Área | Entregado |
| :--- | :--- |
| Imagen | png/jpg/jpeg/webp/gif/bmp/svg/avif/ico → png/jpeg/webp + resize + calidad |
| Audio | mp3/wav/ogg/webm/m4a/aac/flac/mp4 → wav (PCM16 manual), webm (Opus), m4a (AAC u Opus) |
| Vídeo | mp4/webm/mov/m4a/ogv → mp4 (H.264+AAC o **VP9+Opus**), webm (VP8/VP9+Opus), gif animado, m4a/wav (solo audio), png/jpg (frame) |
| Opciones | resolución 360p–1080p/original, fps 24/30/60, bitrate, incluir audio, sampleRate/canales |
| Cola | batch, drag&drop, progreso real, cancelación, reintento, «Probar como WebM» |

## Desviaciones del plan original (y por qué)

1. **Workers y OPFS: NO implementados.** No fueron necesarios para V1 (los tests con 1080p60
   van sobrados); quedan como deuda en `HANDOFF.md`.
2. **Service worker network-first, no cache-first.** El cache-first servía la app vieja tras
   cada deploy (bug fantasma reportado); corregido en v2/v3.
3. **Selección de códec por sonda real (no `isConfigSupported`).** Miente en Chrome (hardware)
   y Firefox (H.264): `configure()` acepta y el encoder muere al primer frame. Se añadió
   `probeVideoEncoder()` (configure + frame real + flush) y **fallback VP9+Opus en MP4** porque
   Firefox no puede codificar H.264/AAC (verificado con sonda en Firefox 157 real).
4. **Recuperación única del encoder** si muere a mitad de bucle (close + reconfigure + reanudar).
5. **ZIP por lote: no implementado** (descarga individual; deuda).
6. **MP3 de salida → `.m4a`** (AAC/Opus): no existe encoder MP3 web; documentado en UI/README.

## Criterio DONE — verificado

- [x] `npm run build --workspace=apps/hydra-convert` verde
- [x] `npm run test:convert` (Chrome smoke) verde, 0 console errors
- [x] `npm run test:convert:video` 7/7 vídeos reales `done`
- [x] `npm run test:convert:firefox` 6/6 en Firefox real, 0 console errors
- [x] Conversión real verificada: png→webp, wav→wav, mp4→mp4 (H.264 en Chrome, VP9 en Firefox), mp4→webm
- [x] Sin `fetch(http)` en runtime (`grep` limpio en `src/`)
- [x] UI responsive 390px + 1440px sin scroll horizontal
- [x] Deploy en Cloudflare Pages con `_redirects` + `_headers` + PWA offline
