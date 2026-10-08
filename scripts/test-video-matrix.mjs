/**
 * Matriz de pruebas de vídeo de Hydra Convert (puppeteer-core + Chrome real).
 *
 * - Genera 6 fixtures con /usr/bin/ffmpeg en /tmp/opencode/matrix/:
 *   1080p30 con audio (3s), 1080p60 (3s), vertical 720x1280 (2s),
 *   dimensiones impares 321x241 (2s), mov con audio (2s), mp4 sin audio (2s).
 * - Para cada fixture: página nueva sobre el preview (:5174, reutilizado si
 *   está up; si no, `vite build` si falta dist + preview en background),
 *   subida vía uploadFile a #file-input, clic en #convert-all con opciones
 *   POR DEFECTO (mp4) y espera de done/error (timeout 120s).
 * - Caso extra: con el 1080p30, resolución 480p + fps 24 (opciones de la UI
 *   elegidas por texto visible) y registro del resultado.
 * - Resumen en tabla por consola. EXIT 1 si algún mensaje contiene
 *   'must be configured', si hay console errors, o si TODOS los casos
 *   fallan; EXIT 0 en otro caso.
 * - Solo screenshots al fallar: test-artifacts/matrix-fail-<nombre>.png.
 * - El preview lanzado por el script se mata al final (try/finally).
 *
 * Uso: `node apps/hydra-convert/scripts/test-video-matrix.mjs` (desde la raíz).
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const CHROME_PATH = '/usr/bin/google-chrome-stable';
const FFMPEG = '/usr/bin/ffmpeg';
const PORT = 5174;
const BASE_URL = `http://localhost:${PORT}/`;
const CASE_TIMEOUT_MS = 120_000;

const thisDir = dirname(fileURLToPath(import.meta.url));
const appDir = dirname(thisDir);
const artifactsDir = join(appDir, 'test-artifacts');
const matrixDir = '/tmp/opencode/matrix';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sh(args) {
  return `${FFMPEG} ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}`;
}

function ffmpeg(args, outFile) {
  const cmd = sh(args);
  console.log(`[ffmpeg] ${cmd}`);
  const r = spawnSync(FFMPEG, args, { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`ffmpeg falló generando ${outFile} (exit ${r.status})`);
}

/** Genera los 6 fixtures. Comandos print-ready con `-v error -y`. */
function generateFixtures() {
  mkdirSync(matrixDir, { recursive: true });
  if (!existsSync(FFMPEG)) throw new Error(`No existe ${FFMPEG}; instala ffmpeg.`);

  const cases = [
    {
      name: '1080p30-con-audio.mp4',
      args: [
        '-v', 'error', '-y',
        '-f', 'lavfi', '-i', 'testsrc=size=1920x1080:rate=30:duration=3',
        '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30',
        '-c:a', 'aac', '-ar', '44100', '-ac', '2', '-shortest',
        join(matrixDir, '1080p30-con-audio.mp4'),
      ],
    },
    {
      name: '1080p60.mp4',
      args: [
        '-v', 'error', '-y',
        '-f', 'lavfi', '-i', 'testsrc=size=1920x1080:rate=60:duration=3',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '60', '-an',
        join(matrixDir, '1080p60.mp4'),
      ],
    },
    {
      name: 'vertical-720x1280.mp4',
      args: [
        '-v', 'error', '-y',
        '-f', 'lavfi', '-i', 'testsrc=size=720x1280:rate=30:duration=2',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30', '-an',
        join(matrixDir, 'vertical-720x1280.mp4'),
      ],
    },
    {
      // libx264 exige dimensiones pares: VP9 sí permite impares y Chrome
      // lo decodifica dentro de .mp4 (mismo contenedor que el resto).
      name: 'impar-321x241.mp4',
      args: [
        '-v', 'error', '-y',
        '-f', 'lavfi', '-i', 'testsrc=size=322x242:rate=30:duration=2',
        '-vf', 'scale=321:241',
        '-c:v', 'libvpx-vp9', '-b:v', '1M', '-r', '30', '-an',
        join(matrixDir, 'impar-321x241.mp4'),
      ],
    },
    {
      name: 'clip-con-audio.mov',
      args: [
        '-v', 'error', '-y',
        '-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=30:duration=2',
        '-f', 'lavfi', '-i', 'sine=frequency=880:duration=2',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30',
        '-c:a', 'aac', '-ar', '44100', '-ac', '2', '-shortest',
        join(matrixDir, 'clip-con-audio.mov'),
      ],
    },
    {
      name: 'clip-sin-audio.mp4',
      args: [
        '-v', 'error', '-y',
        '-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=30:duration=2',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30', '-an',
        join(matrixDir, 'clip-sin-audio.mp4'),
      ],
    },
  ];

  for (const c of cases) {
    const out = join(matrixDir, c.name);
    if (existsSync(out)) {
      console.log(`[ffmpeg] existe, se reutiliza: ${out}`);
      continue;
    }
    ffmpeg(c.args, c.name);
  }
  return cases.map((c) => join(matrixDir, c.name));
}

async function isPreviewUp() {
  try {
    const res = await fetch(BASE_URL, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

function runCommand(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: 'inherit', shell: false });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`)),
    );
  });
}

async function waitForPreview(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isPreviewUp()) return true;
    await sleep(500);
  }
  return false;
}

function sanitize(name) {
  return basename(name).replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
}

/** Elige la opción del <select> de Resolución por texto visible (p. ej. '480p'). */
async function selectResolutionByText(page, visibleText) {
  const value = await page.evaluate((text) => {
    const panel = document.getElementById('options-panel');
    if (!panel) throw new Error('#options-panel ausente');
    const selects = Array.from(panel.querySelectorAll('select'));
    for (const sel of selects) {
      const opt = Array.from(sel.options).find((o) =>
        o.textContent?.trim().toLowerCase().includes(text.toLowerCase()),
      );
      if (opt) {
        sel.value = opt.value;
        sel.dispatchEvent(new Event('input', { bubbles: true }));
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        return opt.value;
      }
    }
    return null;
  }, visibleText);
  if (!value) throw new Error(`Opción de resolución con texto '${visibleText}' no encontrada`);
  return value;
}

/** Clica el botón segmentado de fps por texto visible (p. ej. '24'). */
async function clickFpsByText(page, visibleText) {
  const clicked = await page.evaluate((text) => {
    const panel = document.getElementById('options-panel');
    if (!panel) return false;
    const btn = Array.from(panel.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === text,
    );
    if (!btn) return false;
    btn.click();
    return true;
  }, visibleText);
  if (!clicked) throw new Error(`Botón de fps con texto '${visibleText}' no encontrado`);
}

/** Clica la pestaña 'Vídeo' del panel de opciones (por texto visible). */
async function clickVideoTab(page) {
  await page.evaluate(() => {
    const panel = document.getElementById('options-panel');
    const tab = Array.from(panel?.querySelectorAll('[role="tab"]') ?? []).find((b) =>
      /v[íi]deo/i.test(b.textContent ?? ''),
    );
    tab?.click();
  });
}

async function readJobState(page) {
  return page.evaluate(() => {
    const li = document.querySelector('[data-job-id]');
    if (!li) return { status: 'missing', message: 'sin job en la cola', fileName: '' };
    const titles = Array.from(li.querySelectorAll('p[title]')).map((p) => p.getAttribute('title') ?? '');
    return {
      status: li.getAttribute('data-status') ?? 'unknown',
      message: titles.length > 1 ? titles[titles.length - 1] : '',
      fileName: titles[0] ?? '',
    };
  });
}

async function runCase(browser, filePath, opts = {}) {
  const label = opts.label ?? basename(filePath);
  const page = await browser.newPage();
  const caseConsoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') caseConsoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) =>
    caseConsoleErrors.push(`pageerror: ${String(err?.message ?? err)}`),
  );
  const t0 = Date.now();
  let status = 'error';
  let message = '';
  try {
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(BASE_URL, { waitUntil: 'load', timeout: 30000 });
    await page.waitForSelector('#file-input', { timeout: 15000 });
    await page.waitForSelector('#convert-all', { timeout: 15000 });

    if (opts.configure) {
      // Subir primero para que el panel muestre la pestaña de vídeo.
      const input0 = await page.$('#file-input');
      if (!input0) throw new Error('#file-input ausente');
      await input0.uploadFile(filePath);
      await page.waitForSelector('[data-job-id]', { timeout: 15000 });
      await clickVideoTab(page);
      const res = await selectResolutionByText(page, opts.configure.resolution);
      await clickFpsByText(page, opts.configure.fps);
      console.log(`[case ${label}] opciones UI: resolución=${res}, fps=${opts.configure.fps}`);
    } else {
      const input = await page.$('#file-input');
      if (!input) throw new Error('#file-input ausente');
      await input.uploadFile(filePath);
      await page.waitForSelector('[data-job-id]', { timeout: 15000 });
    }

    await page.click('#convert-all');
    await page.waitForFunction(
      () => {
        const li = document.querySelector('[data-job-id]');
        const s = li?.getAttribute('data-status');
        return s === 'done' || s === 'error';
      },
      { timeout: CASE_TIMEOUT_MS },
    );
    const state = await readJobState(page);
    status = state.status;
    message = state.message;
  } catch (err) {
    status = 'error';
    message = err instanceof Error ? err.message : String(err);
  }
  const durationMs = Date.now() - t0;

  if (status !== 'done') {
    try {
      const shot = join(artifactsDir, `matrix-fail-${sanitize(label)}.png`);
      await page.screenshot({ path: shot });
      console.log(`[case ${label}] screenshot: ${shot}`);
    } catch {
      /* best-effort */
    }
  }
  try {
    await page.close();
  } catch {
    /* ya cerrada */
  }
  return { archivo: label, status, mensaje: message, duraciónMs: durationMs, consoleErrors: caseConsoleErrors.length };
}

async function main() {
  mkdirSync(artifactsDir, { recursive: true });
  const fixtures = generateFixtures();

  let previewChild = null;
  if (await isPreviewUp()) {
    console.log(`[test] Reutilizando preview existente en ${BASE_URL}`);
  } else {
    if (!existsSync(join(appDir, 'dist', 'index.html'))) {
      console.log('[test] dist ausente: construyendo con `vite build`…');
      await runCommand('npx', ['vite', 'build'], appDir);
    }
    console.log(`[test] Lanzando \`vite preview --port ${PORT}\` en background…`);
    previewChild = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
      cwd: appDir,
      stdio: 'inherit',
      shell: false,
    });
    if (!(await waitForPreview())) {
      previewChild.kill();
      throw new Error('El preview de Vite no respondió a tiempo.');
    }
  }

  let browser = null;
  const results = [];
  try {
    browser = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--enable-unsafe-swiftshader',
        '--autoplay-policy=no-user-gesture-required',
        '--window-size=1440,900',
      ],
    });

    for (const f of fixtures) {
      console.log(`[test] Caso (defecto mp4): ${basename(f)}…`);
      results.push(await runCase(browser, f));
    }

    console.log('[test] Caso extra: 1080p30 + 480p/24fps…');
    const hd30 = fixtures[0];
    results.push(
      await runCase(browser, hd30, {
        label: '1080p30-con-audio.mp4 [480p/24fps]',
        configure: { resolution: '480p', fps: '24' },
      }),
    );

    console.log('\n==== MATRIZ VÍDEO ====');
    console.table(results);

    const mustBeConfigured = results.filter((r) => /must be configured/i.test(r.mensaje));
    const totalConsoleErrors = results.reduce((n, r) => n + r.consoleErrors, 0);
    const failed = results.filter((r) => r.status !== 'done');

    if (mustBeConfigured.length > 0) {
      console.error(
        `[test] FALLO: ${mustBeConfigured.length} caso(s) con 'must be configured': ` +
          mustBeConfigured.map((r) => r.archivo).join(', '),
      );
      process.exitCode = 1;
    } else if (totalConsoleErrors > 0) {
      console.error(`[test] FALLO: ${totalConsoleErrors} console error(s) en total.`);
      process.exitCode = 1;
    } else if (failed.length === results.length && results.length > 0) {
      console.error('[test] FALLO: todos los casos fallaron.');
      for (const r of failed) console.error(`  - ${r.archivo}: ${r.mensaje}`);
      process.exitCode = 1;
    } else {
      if (failed.length > 0) {
        console.warn(`[test] ${failed.length} caso(s) con error (no bloqueante):`);
        for (const r of failed) console.warn(`  - ${r.archivo}: ${r.mensaje}`);
      }
      console.log('[test] MATRIZ OK (criterios de fallo no alcanzados).');
      process.exitCode = 0;
    }
  } finally {
    if (browser) await browser.close();
    if (previewChild) {
      previewChild.kill('SIGTERM');
      console.log('[test] Preview en background detenido.');
    }
  }
}

main().catch((err) => {
  console.error(`[test] FALLO: ${err.message}`);
  process.exit(1);
});
