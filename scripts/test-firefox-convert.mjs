/**
 * Suite E2E de Hydra Convert en FIREFOX REAL headless (puppeteer-core,
 * Browser.setDownloadBehavior no aplica: se valida nombre de salida vía
 * aria-label del botón de descarga).
 *
 * - Reutiliza `vite preview` en localhost:5174 si ya está corriendo;
 *   si no, construye `dist` (si falta) y lanza el preview en background.
 *   Los comandos se ejecutan con cwd = apps/hydra-convert.
 * - Genera fixtures reales con ffmpeg en /tmp/opencode/ff-fixtures/.
 * - Casos: mp4→mp4, webm→mp4, mp4→webm, wav→wav, wav→m4a, png→webp.
 * - Falla duro si algún caso termina en error / timeout / extensión
 *   incorrecta, o si hay console errors o pageerrors.
 * - Screenshot de fallo en test-artifacts/firefox-fail-<caso>.png.
 *
 * Uso: `node apps/hydra-convert/scripts/test-firefox-convert.mjs`
 * (puede lanzarse desde cualquier cwd; usa el dirname del script).
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const FIREFOX_PATH = '/usr/bin/firefox';
const PORT = 5174;
const BASE_URL = `http://localhost:${PORT}/`;

const thisDir = dirname(fileURLToPath(import.meta.url));
const appDir = dirname(thisDir);
const artifactsDir = join(appDir, 'test-artifacts');
const fixturesDir = '/tmp/opencode/ff-fixtures';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

// --- Fixtures ffmpeg -------------------------------------------------------

const FIXTURES = [
  {
    name: 'video.mp4',
    args: [
      '-v', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=30',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
      '-t', '2',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k',
      '-shortest',
    ],
  },
  {
    name: 'video.webm',
    args: [
      '-v', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=30',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
      '-t', '2',
      '-c:v', 'libvpx', '-b:v', '1M', '-pix_fmt', 'yuv420p',
      '-c:a', 'libopus', '-b:a', '96k',
      '-shortest',
    ],
  },
  {
    name: 'tono.wav',
    args: [
      '-v', 'error', '-y',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
      '-c:a', 'pcm_s16le', '-ar', '44100',
    ],
  },
  {
    name: 'foto.png',
    args: [
      '-v', 'error', '-y',
      '-f', 'lavfi', '-i', 'color=red:s=200x200',
      '-frames:v', '1',
    ],
  },
];

async function ensureFixtures() {
  mkdirSync(fixturesDir, { recursive: true });
  for (const f of FIXTURES) {
    const out = join(fixturesDir, f.name);
    console.log(`[ff] ffmpeg → ${out}`);
    await runCommand('ffmpeg', [...f.args, out], fixturesDir);
  }
}

// --- Interacción con el panel de opciones ----------------------------------

async function selectTab(page, label) {
  const ok = await page.evaluate((text) => {
    const panel = document.getElementById('options-panel');
    if (!panel) return false;
    const tab = [...panel.querySelectorAll('[role="tab"]')].find(
      (t) => t.textContent.trim() === text,
    );
    if (!tab) return false;
    tab.click();
    return true;
  }, label);
  if (!ok) throw new Error(`Pestaña "${label}" no encontrada en #options-panel`);
}

async function clickOptionsButton(page, label) {
  const ok = await page.evaluate((text) => {
    const panel = document.getElementById('options-panel');
    if (!panel) return false;
    const btn = [...panel.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === text,
    );
    if (!btn) return false;
    btn.click();
    return true;
  }, label);
  if (!ok) throw new Error(`Botón de formato "${label}" no encontrado en #options-panel`);
}

// --- Casos de prueba -------------------------------------------------------
// `prepare` solo se usa cuando hay que cambiar el formato respecto al default
// de la pestaña correspondiente (OptionsPanel: vídeo WebM; audio M4A → .m4a).
const CASES = [
  {
    id: 'mp4-default',
    fixture: 'video.mp4',
    format: 'default (MP4)',
    prepare: null,
    expected: ['.mp4'],
  },
  {
    id: 'webm-to-mp4',
    fixture: 'video.webm',
    format: 'default (MP4)',
    prepare: null,
    expected: ['.mp4'],
  },
  {
    id: 'mp4-to-webm',
    fixture: 'video.mp4',
    format: 'Vídeo → WebM',
    prepare: async (page) => {
      await selectTab(page, 'Vídeo');
      await clickOptionsButton(page, 'WebM');
    },
    expected: ['.webm'],
  },
  {
    id: 'wav-default',
    fixture: 'tono.wav',
    format: 'default (WAV)',
    prepare: null,
    expected: ['.wav'],
  },
  {
    id: 'wav-to-m4a',
    fixture: 'tono.wav',
    format: 'Audio → M4A',
    prepare: async (page) => {
      await selectTab(page, 'Audio');
      await clickOptionsButton(page, 'M4A');
    },
    expected: ['.m4a', '.mp4'],
  },
  {
    id: 'png-default',
    fixture: 'foto.png',
    format: 'default (WebP)',
    prepare: null,
    expected: ['.webp'],
  },
];

function extMatches(outputName, expected) {
  const lower = String(outputName ?? '').toLowerCase();
  return expected.some((ext) => lower.endsWith(ext));
}

async function screenshotFailure(page, caseId) {
  try {
    const path = join(artifactsDir, `firefox-fail-${caseId}.png`);
    await page.screenshot({ path });
    console.log(`[ff] Screenshot de fallo: test-artifacts/firefox-fail-${caseId}.png`);
  } catch (err) {
    console.warn(`[ff] No se pudo capturar screenshot de fallo: ${err.message}`);
  }
}

async function runCase(page, c, idx, total) {
  console.log(`[ff] (${idx}/${total}) ${c.id}: ${c.fixture} → ${c.format} …`);
  try {
    // Recarga limpia: cada caso arranca con la app recién cargada.
    await page.goto(BASE_URL, { waitUntil: 'load', timeout: 60000 });
    await page.waitForSelector('#file-input', { timeout: 30000 });
    await page.waitForSelector('#options-panel', { timeout: 30000 });

    const input = await page.$('#file-input');
    if (!input) throw new Error('#file-input ausente');
    await input.uploadFile(join(fixturesDir, c.fixture));

    await page.waitForSelector('[data-job-id]', { timeout: 30000 });

    if (c.prepare) {
      // Espera a que React refleje el kind del job y exista la pestaña.
      await page.waitForSelector('#options-panel [role="tab"]', { timeout: 15000 });
      await sleep(200);
      await c.prepare(page);
    }

    await page.click('#convert-all');
    try {
      await page.waitForFunction(
        () => {
          const el = document.querySelector('[data-job-id]');
          const s = el ? el.getAttribute('data-status') : null;
          return s === 'done' || s === 'error';
        },
        { timeout: 120000 },
      );
    } catch {
      // Timeout: se reporta como fallo duro tras leer el estado actual.
    }

    const info = await page.evaluate(() => {
      const el = document.querySelector('[data-job-id]');
      const download = el ? el.querySelector('[data-action="download"]') : null;
      return {
        status: el ? el.getAttribute('data-status') : 'missing',
        aria: download ? download.getAttribute('aria-label') : null,
        message: el ? el.innerText.replace(/\s+/g, ' ').trim().slice(0, 240) : '',
      };
    });

    const status = info.status ?? 'missing';
    const outputName = info.aria ? info.aria.replace(/^Descargar\s+/i, '').trim() : null;

    if (status !== 'done') {
      await screenshotFailure(page, c.id);
      return {
        ok: false,
        status,
        outputName,
        detail: `status=${status}; msg=${info.message}`,
      };
    }

    if (!extMatches(outputName, c.expected)) {
      await screenshotFailure(page, c.id);
      return {
        ok: false,
        status,
        outputName,
        detail: `extensión inesperada (esperado ${c.expected.join(' | ')}); aria="${info.aria}"`,
      };
    }

    console.log(`[ff] (${idx}/${total}) ${c.id}: done → ${outputName} OK`);
    return { ok: true, status, outputName, detail: info.message };
  } catch (err) {
    await screenshotFailure(page, c.id);
    return {
      ok: false,
      status: 'exception',
      outputName: null,
      detail: err && err.message ? err.message : String(err),
    };
  }
}

function printSummary(results) {
  const rows = results.map((r, i) => ({
    n: String(i + 1),
    caso: r.id,
    fixture: r.fixture,
    formato: r.format,
    estado: r.status,
    salida: r.outputName ?? '—',
    ok: r.ok ? 'OK' : 'FAIL',
  }));
  const cols = [
    ['n', 2],
    ['caso', 16],
    ['fixture', 12],
    ['formato', 16],
    ['estado', 10],
    ['salida', 22],
    ['ok', 5],
  ];
  const line = (vals) => cols.map(([k, w]) => String(vals[k]).padEnd(w)).join('  ');
  console.log('\n[ff] ===== RESUMEN =====');
  console.log(line(Object.fromEntries(cols.map(([k, w]) => [k, k === 'n' ? '#' : k.toUpperCase()]))));
  console.log(line(Object.fromEntries(cols.map(([k, w]) => [k, '-'.repeat(w)]))));
  for (const r of rows) console.log(line(r));
  const fails = results.filter((r) => !r.ok);
  console.log(`[ff] Casos: ${results.length - fails.length}/${results.length} OK, ${fails.length} FAIL`);
  for (const r of fails) console.log(`[ff]   FAIL ${r.id}: ${r.detail}`);
}

async function main() {
  mkdirSync(artifactsDir, { recursive: true });

  await ensureFixtures();

  let previewChild = null;
  if (await isPreviewUp()) {
    console.log(`[ff] Reutilizando preview existente en ${BASE_URL}`);
  } else {
    if (!existsSync(join(appDir, 'dist', 'index.html'))) {
      console.log('[ff] dist ausente: construyendo con `vite build`…');
      await runCommand('npx', ['vite', 'build'], appDir);
    }
    console.log(`[ff] Lanzando \`vite preview --port ${PORT}\` en background…`);
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

  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  const results = [];
  let browser = null;
  try {
    browser = await puppeteer.launch({
      browser: 'firefox',
      executablePath: FIREFOX_PATH,
      headless: true,
      extraPrefsFirefox: {
        'remote.active-protocols': 1,
      },
    });
    console.log(`[ff] Firefox: ${await browser.version()}`);

    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(String(err && err.message ? err.message : err)));
    page.on('requestfailed', (req) => {
      failedRequests.push(`${req.url()} :: ${req.failure()?.errorText ?? 'unknown'}`);
    });

    for (let i = 0; i < CASES.length; i++) {
      const c = CASES[i];
      const r = await runCase(page, c, i + 1, CASES.length);
      results.push({ ...c, ...r });
    }

    printSummary(results);

    if (failedRequests.length > 0) {
      console.warn(`[ff] ${failedRequests.length} peticiones fallidas (informativo):`);
      for (const r of failedRequests) console.warn(`  - ${r}`);
    }

    console.log(`[ff] Console errors: ${consoleErrors.length}, page errors: ${pageErrors.length}`);
    for (const e of [...consoleErrors, ...pageErrors]) console.log(`  [console-error] ${e}`);

    const caseFails = results.filter((r) => !r.ok);
    const totalErrors = consoleErrors.length + pageErrors.length;
    if (caseFails.length > 0) {
      throw new Error(`${caseFails.length} caso(s) fallaron: ${caseFails.map((r) => r.id).join(', ')}`);
    }
    if (totalErrors > 0) {
      throw new Error(`Suite con ${totalErrors} errores de consola/página.`);
    }
    console.log('[ff] FIREFOX E2E OK — 6/6 conversiones y 0 console errors.');
  } finally {
    if (browser) await browser.close();
    if (previewChild) {
      previewChild.kill('SIGTERM');
      console.log('[ff] Preview en background detenido.');
    }
  }
}

main().catch((err) => {
  console.error(`[ff] FALLO: ${err.message}`);
  process.exit(1);
});
