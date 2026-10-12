// بيحوّل rilio-promo.html لفيديو MP4: بيلقط كل فريم بـ Playwright ويبعته لـ ffmpeg.
// التشغيل (من فولدر المشروع):
//   node promo/render.mjs                      → promo/out/rilio-promo.mp4 (بالصوت لو promo/out/music.wav موجود)
//   node promo/render.mjs --stills 3,15,40     → صور PNG للثواني دي في promo/out/stills للمراجعة
//   node promo/render.mjs --fps 30 --workers 4 --from 0 --to 132
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

// playwright من المشروع لو متثبّت، وإلا من التثبيت العام (npm i -g playwright)
const req = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = req('playwright')); } catch { ({ chromium } = req(path.join(execSync('npm root -g').toString().trim(), 'playwright'))); }

const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(here, '..');
const out = path.join(here, 'out');
fs.mkdirSync(out, { recursive: true });
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const FPS = +arg('fps', 30);
const WORKERS = +arg('workers', 4);
const stills = arg('stills', '');

// سيرفر محلي صغير: الخطوط مبتشتغلش من file://
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/promo/rilio-promo.html`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--force-color-profile=srgb', '--font-render-hinting=none'] });
async function openPage() {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.text()); });
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  await page.goto(url);
  await page.evaluate(() => window.ready);
  return page;
}

if (stills) {
  const dir = path.join(out, 'stills');
  fs.mkdirSync(dir, { recursive: true });
  const page = await openPage();
  for (const t of stills.split(',').map(Number)) {
    await page.evaluate(t => window.seek(t), t);
    await page.screenshot({ path: path.join(dir, `t${String(t).padStart(6, '0')}.png`) });
  }
  console.log('stills in', dir);
} else {
  const page0 = await openPage();
  const dur = await page0.evaluate(() => window.DURATION);
  await page0.close();
  const from = +arg('from', 0), to = +arg('to', dur);
  const total = Math.round((to - from) * FPS);
  const per = Math.ceil(total / WORKERS);
  const t0 = Date.now();
  let done = 0;
  const parts = [];
  await Promise.all(Array.from({ length: WORKERS }, async (_, w) => {
    const a = w * per, b = Math.min(total, a + per);
    if (a >= b) return;
    const file = path.join(out, `part${w}.mp4`);
    parts[w] = file;
    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', String(FPS), file], { stdio: ['pipe', 'inherit', 'inherit'] });
    const page = await openPage();
    for (let f = a; f < b; f++) {
      await page.evaluate(t => window.seek(t), from + f / FPS);
      const buf = await page.screenshot({ type: 'jpeg', quality: 95 });
      if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
      if (++done % 150 === 0) console.log(`${done}/${total} frames · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
    ff.stdin.end();
    await new Promise(r => ff.on('close', r));
    await page.close();
  }));
  const list = path.join(out, 'parts.txt');
  fs.writeFileSync(list, parts.filter(Boolean).map(p => `file '${p}'`).join('\n'));
  const video = path.join(out, 'video-only.mp4');
  await run(['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', video]);
  const music = path.join(out, 'music.wav');
  const final = path.join(out, 'rilio-promo.mp4');
  if (fs.existsSync(music)) await run(['-y', '-loglevel', 'error', '-i', video, '-i', music, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', final]);
  else fs.copyFileSync(video, final);
  parts.forEach(p => p && fs.rmSync(p, { force: true }));
  fs.rmSync(list, { force: true });
  console.log('done:', final, `${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
await browser.close();
server.close();

function run(args) {
  return new Promise((res, rej) => spawn('ffmpeg', args, { stdio: 'inherit' }).on('close', c => (c ? rej(new Error('ffmpeg ' + c)) : res())));
}
