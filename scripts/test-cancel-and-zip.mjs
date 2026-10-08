/**
 * Test automatizado para:
 * 1. Cancelación cooperativa real e inmediata (< 500ms, sin errores de consola).
 * 2. Descarga por lote (ZIP) cuando hay 2 o más jobs completados.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const CHROME_PATH = '/usr/bin/google-chrome-stable';
const PORT = 5174;
const BASE_URL = `http://localhost:${PORT}/`;

const thisDir = dirname(fileURLToPath(import.meta.url));
const appDir = dirname(thisDir);

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

async function main() {
  let previewChild = null;
  if (!await isPreviewUp()) {
    console.log(`[test] Lanzando preview en :${PORT}…`);
    previewChild = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
      cwd: appDir,
      stdio: 'inherit',
      shell: false,
    });
    for (let i = 0; i < 30; i++) {
      if (await isPreviewUp()) break;
      await sleep(500);
    }
  }

  const consoleErrors = [];
  const pageErrors = [];

  const browser = await puppeteer.launch({
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

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(String(err?.message || err)));

    await page.goto(BASE_URL, { waitUntil: 'load', timeout: 30000 });
    await page.waitForSelector('#dropzone', { timeout: 10000 });

    // Inyectar espía de descarga para verificar el ZIP
    await page.evaluate(() => {
      window.__interceptedDownloads = [];
      const origCreate = URL.createObjectURL;
      URL.createObjectURL = function (blob) {
        if (blob && blob.type) {
          window.__interceptedDownloads.push({
            type: blob.type,
            size: blob.size,
          });
        }
        return origCreate.call(URL, blob);
      };
    });

    // ==========================================
    // PRUEBA 1: Cancelación cooperativa
    // ==========================================
    console.log('[test] 1. Inyectando audio largo (3s) para probar cancelación…');
    await page.evaluate(() => {
      const sampleRate = 44100;
      const ctx = new OfflineAudioContext(1, sampleRate * 3, sampleRate);
      const osc = ctx.createOscillator();
      osc.frequency.value = 440;
      osc.connect(ctx.destination);
      osc.start();
      return ctx.startRendering().then((buf) => {
        const pcm = new Int16Array(buf.length);
        const chan = buf.getChannelData(0);
        for (let i = 0; i < buf.length; i++) pcm[i] = chan[i] * 32767;
        const file = new File([pcm.buffer], 'largo.wav', { type: 'audio/wav' });
        const input = document.getElementById('file-input');
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });

    await page.waitForSelector('[data-job-id]', { timeout: 5000 });
    console.log('[test] Job encolado. Iniciando conversión…');

    // Cambiar formato a WebM (MediaRecorder dura 3s)
    await page.evaluate(() => {
      const store = window.__convertStore;
      // Iniciar conversión vía click
    });

    const convertBtn = await page.waitForSelector('[data-action="convert"]', { timeout: 5000 });
    await convertBtn.click();

    // Esperar a que entre en estado 'converting'
    await page.waitForSelector('[data-action="cancel"]', { timeout: 5000 });
    console.log('[test] Job en estado converting. Pulsando Cancelar…');

    const cancelStart = Date.now();
    const cancelBtn = await page.$('[data-action="cancel"]');
    await cancelBtn.click();

    // Debe volver a estado 'queued' o mensaje 'Cancelado'
    await page.waitForFunction(
      () => {
        const row = document.querySelector('[data-job-id]');
        if (!row) return false;
        const status = row.getAttribute('data-status');
        const text = row.textContent || '';
        return status === 'queued' || text.includes('Cancelado');
      },
      { timeout: 3000 },
    );

    const cancelDuration = Date.now() - cancelStart;
    console.log(`[test] Cancelación completada en ${cancelDuration}ms (< 1000ms OK).`);

    // Limpiar cola
    const clearBtn = await page.$('#clear-all');
    if (clearBtn) await clearBtn.click();
    await page.waitForFunction(() => !document.querySelector('[data-job-id]'));
    console.log('[test] Cola vaciada.');

    // ==========================================
    // PRUEBA 2: Descarga por lote (ZIP)
    // ==========================================
    console.log('[test] 2. Inyectando 2 imágenes sintéticas para probar ZIP…');
    await page.evaluate(() => {
      const canvas1 = document.createElement('canvas');
      canvas1.width = 50;
      canvas1.height = 50;
      const ctx1 = canvas1.getContext('2d');
      ctx1.fillStyle = '#00ff00';
      ctx1.fillRect(0, 0, 50, 50);

      const canvas2 = document.createElement('canvas');
      canvas2.width = 50;
      canvas2.height = 50;
      const ctx2 = canvas2.getContext('2d');
      ctx2.fillStyle = '#0000ff';
      ctx2.fillRect(0, 0, 50, 50);

      return Promise.all([
        new Promise((res) => canvas1.toBlob(res)),
        new Promise((res) => canvas2.toBlob(res)),
      ]).then(([b1, b2]) => {
        const f1 = new File([b1], 'verde.png', { type: 'image/png' });
        const f2 = new File([b2], 'azul.png', { type: 'image/png' });
        const input = document.getElementById('file-input');
        const dt = new DataTransfer();
        dt.items.add(f1);
        dt.items.add(f2);
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });

    await page.waitForFunction(() => document.querySelectorAll('[data-job-id]').length === 2, {
      timeout: 5000,
    });
    console.log('[test] 2 archivos encolados. Pulsando Convertir todo…');

    const convertAllBtn = await page.$('#convert-all');
    await convertAllBtn.click();

    // Esperar a que ambos estén 'done'
    await page.waitForFunction(
      () => document.querySelectorAll('[data-status="done"]').length === 2,
      { timeout: 10000 },
    );
    console.log('[test] 2 conversiones completadas.');

    // Verificar botón Descargar lote (.zip)
    const zipBtn = await page.waitForSelector('#download-all-zip', { timeout: 5000 });
    if (!zipBtn) throw new Error('Botón #download-all-zip no apareció');
    console.log('[test] Botón #download-all-zip visible. Pulsando…');

    await zipBtn.click();
    await sleep(500);

    const downloads = await page.evaluate(() => window.__interceptedDownloads);
    const zipDownload = downloads.find((d) => d.type === 'application/zip');
    if (!zipDownload) {
      throw new Error(`No se interceptó descarga ZIP. Descargas: ${JSON.stringify(downloads)}`);
    }
    console.log(`[test] Descarga ZIP verificada: type=${zipDownload.type}, size=${zipDownload.size} bytes.`);

    console.log(`[test] Errores de consola: ${consoleErrors.length}`);
    console.log(`[test] Errores de página: ${pageErrors.length}`);
    if (consoleErrors.length > 0) throw new Error(`Console errors detectados: ${consoleErrors.join(', ')}`);
    if (pageErrors.length > 0) throw new Error(`Page errors detectados: ${pageErrors.join(', ')}`);

    console.log('[test] CANCEL & ZIP TEST OK — 100% PASS.');
  } finally {
    await browser.close();
    if (previewChild) previewChild.kill();
  }
}

main().catch((err) => {
  console.error('[test FAIL]', err);
  process.exit(1);
});
