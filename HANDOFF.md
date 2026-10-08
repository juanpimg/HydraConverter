# HANDOFF — Hydra Convert (estado para otra sesión)

> Escrito el 2026-10-08. Fuente de verdad: el código + este archivo.
> Regla de oro: **todo lo marcado "sin verificar" no se debe dar por hecho.**

## 1. Dónde está el código

| Ubicación | Rol |
| :--- | :--- |
| `editor/apps/hydra-convert/` (monorepo) | **Desarrollo** — aquí se trabaja y se prueban los cambios |
| `Proyectos/HydraConverter/` (repo independiente) | **Deploy** — se sincroniza y se sube a GitHub |

- Remoto de deploy: `https://github.com/juanpimg/HydraConverter.git` (`origin`, rama `main`).
- Cloudflare Pages redespliega automáticamente al hacer push a `main` (config en README).
- **Último commit desplegado:** `6b3737e` (Firefox VP9+Opus + SW v3), versión `v1.0.2`.
- Sincronización (desde la raíz del monorepo):

```bash
npm run sync:convert
# equivale a:
rsync -a --delete --exclude node_modules --exclude dist --exclude test-artifacts \
  --exclude .git --exclude package-lock.json \
  apps/hydra-convert/ ../HydraConverter/
cd ../HydraConverter && git add -A && git commit -m "..." && git push origin main
```

## 2. Verificación actual (todo verde, 2026-10-09)

| Prueba | Comando | Resultado |
| :--- | :--- | :--- |
| Tipos + build | `npm run build --workspace=apps/hydra-convert` | ✅ tsc + vite build limpio (0 errores) |
| Unitarios vitest | `npm run test:convert:unit` | ✅ 8/8 tests (ZIP, CRC32, formatBytes, detectKindByMime) |
| Cancel & ZIP E2E | `npm run test:convert:cancel-zip` | ✅ Cancelación en 46ms (<1s) y descarga de `.zip` verificada con 0 console errors |
| Chrome smoke | `npm run test:convert` | ✅ PNG→WebP (descarga verificada), WAV→WAV, móvil 390px sin scroll horizontal, 0 console errors |
| Chrome matriz vídeo | `npm run test:convert:video` | ✅ 7/7 `done`: 1080p30, 1080p60, vertical 720x1280, impar 321x241, mov, sin audio, 480p/24fps |
| Firefox E2E | `npm run test:convert:firefox` | ✅ 6/6 `done`: mp4, webm→mp4, webm, wav, m4a, webp; 0 console errors |
| Contenido MP4 en Firefox | interceptar blob + `ffprobe` | ✅ `vp9` + `opus` en MP4, decodifica limpio (`ffmpeg -f null`) |

> ⚠️ **Las suites de navegador deben correrse EN SERIE.** 2-3 Chromes headless en paralelo
> (SwiftShader por software) se matan entre sí: páginas `Detached` y timeouts falsos.
> No es regresión del código.

## 3. Decisiones técnicas tomadas (no reabrir sin motivo)

1. **Firefox Linux no puede codificar H.264 ni AAC.** Verificado con sonda real en Firefox 157:
   `isConfigSupported` devuelve `true` para H.264 (prefer-software) pero la codificación real
   **falla**; AAC devuelve `false`. → Fallback automático **VP9 + Opus en MP4** (mp4-muxer v5
   soporta `'vp9'` y `'opus'`). H.264/AAC se conserva cuando existe (Chrome).
2. **Selección de códec por SONDA REAL, nunca por `isConfigSupported` a secas:**
   `probeVideoEncoder()` = encoder temporal + frame 64x64 + `flush()`. Miente en Chrome
   (hardware) y en Firefox (H.264). Matriz: avc L5.2→Baseline × HW/SW y, si falla, vp9 × SW/default.
3. **Cancelación cooperativa inmediata con `AbortSignal`:** `convertVideo`, `convertAudio` y
   `convertImage` reciben `signal?: AbortSignal`. Al cancelar en la UI, el `AbortController`
   aborta al instante (<50ms), deteniendo la codificación de fotogramas, cerrando el `VideoEncoder`,
   pausando el elemento de vídeo y revocando URLs de objeto sin malgastar CPU/GPU.
4. **Optimización de audio en MP4:** el archivo se lee y decodifica a `AudioBuffer` una sola vez.
   Si AAC no está disponible (ej. Firefox), se remuestrea en memoria a 48 kHz vía `OfflineAudioContext`
   para Opus sin re-leer el archivo del disco.
5. **Descarga ZIP por lote nativa (zero-deps):** `src/utils/zip.ts` crea archivos `.zip` estándar
   (método Store, CRC32, cabeceras locales y directorio central) en el navegador sin ninguna librería
   externa. Si hay 2 o más jobs completados, la UI muestra «Descargar lote (.zip) (N)».
6. **Detección de compatibilidad WebM:** la UI advierte si WebM no está soportado (ej. Safari / WebKit)
   para evitar fallos de tiempo de ejecución.
7. **Prefijos contractuales de error:** `H264_NO_DISPONIBLE: ` solo si **ningún** encoder de
   vídeo inicializa (la UI muestra «Probar como WebM»); `AUDIO_NO_DISPONIBLE: ` análogo en audio.
   La UI (`App.tsx`) depende de esos prefijos para `errorCode` — no cambiarlos sin tocar la UI.
8. **Service worker network-first para navegaciones** (cache actual `hydra-convert-v3`).
9. **Zero leaks:** cada `VideoFrame`/`AudioData` se cierra en `finally`; `URL.revokeObjectURL`
   en todos los caminos; backpressure `encodeQueueSize <= 3` con sondeo que detecta muerte del encoder.

## 4. Historial de commits del deploy

| Commit | Contenido |
| :--- | :--- |
| `fa8523e` | v1 inicial: conversores + UI + Cloudflare Pages ready |
| `b25277d` | Fix H.264: sonda real de config (L5.2/Baseline × HW/SW) y causa real ante muerte asíncrona |
| `85a0650` | Recuperación única + «Probar como WebM» en UI + SW network-first v2 + matriz de vídeo |
| `6b3737e` | Firefox MP4 VP9+Opus (fallback automático H.264/AAC), audio m4a→opus-in-mp4, SW v3, suite Firefox E2E |
| `PRÓXIMO` | **Actual**: Cancelación cooperativa `AbortSignal` (<50ms), ZIP lote nativo, tests vitest (8/8), suite cancel-zip y audio buffer reuse |

## 5. Deuda / próximos pasos sugeridos

1. **Probar en Safari/iOS real y Firefox Windows** (los caminos de códec pueden variar).
2. **OPFS para archivos gigantes** (hoy todo se procesa en memoria).
3. **Web Worker para lotes de imágenes** (hoy todo en el hilo principal).
4. **Calidad GIF:** paleta 3-3-2 sin dithering; mejorable con cuantización por mediana.
5. **i18n:** toda la UI está en español.

## 6. Comandos

```bash
# Desde la raíz del monorepo
npm run dev:convert            # dev en :5174
npm run build:convert          # tsc + vite
npm run test:convert:unit      # 8 tests vitest
npm run test:convert:cancel-zip# cancel y zip batch E2E
npm run test:convert           # Chrome smoke
npm run test:convert:video     # Chrome matriz de vídeo
npm run test:convert:firefox   # Firefox E2E
npm run sync:convert           # sincronizar al repo de deploy

# Verificar deploy
cd ../HydraConverter && git ls-remote origin HEAD   # debe coincidir con git rev-parse HEAD
```
