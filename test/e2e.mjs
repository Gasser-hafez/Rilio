// فحص end-to-end: بيشغّل البرنامج في فولدر بيانات مؤقت ويتأكد من الحمايات ومن إشعارات المواسم
// محتاج نت (بيحمّل example.com كـ iframe خارجي). التشغيل: npm test
import { spawn, execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const electron = createRequire(import.meta.url)('electron');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..');
const PORT = 9333;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function launch(userData, { port = PORT, env = {}, args = [] } = {}) {
  // لو نافذة التست متغطية بنافذة تانية، ويندوز بيعلّمها hidden وChromium بيوقف توصيل الضغطات —
  // الـ flags دي بتخلي التست مايعتمدش على ترتيب النوافذ على الشاشة
  const flags = ['--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'];
  const proc = spawn(electron, [root, `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`, ...flags, ...args], { stdio: 'ignore', env: { ...process.env, ...env } });
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      if (list.some(t => t.url.startsWith('app://local/'))) { await sleep(1500); return proc; }
    } catch (e) {}
  }
  proc.kill();
  throw new Error('app did not start');
}

const targets = async (port = PORT) => (await (await fetch(`http://127.0.0.1:${port}/json`)).json());
async function conn(match, port = PORT) {
  const t = (await targets(port)).find(x => x.url.includes(match));
  assert.ok(t, `target ${match} not found`);
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(r => { ws.onopen = r; });
  let id = 0; const pend = {};
  const listeners = {};
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.method) listeners[d.method]?.(d.params); else pend[d.id]?.(d.result); };
  const call = (method, params = {}) => new Promise(r => { pend[++id] = r; ws.send(JSON.stringify({ id, method, params })); });
  call.ev = async expr => {
    const r = await call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  call.on = (method, fn) => { listeners[method] = fn; };
  call.close = () => ws.close();
  // نافذة البرنامج: نستنى app.js يخلص تحميل — على GitHub Actions الجهاز أبطأ، والتست كان بيبدأ قبله
  // (حصلت في 4.8.0: "checkSeasons is not defined")
  if (t.url.startsWith('app://local')) {
    for (let i = 0; i < 100; i++) {
      try { if (await call.ev(`document.readyState==='complete'&&typeof render==='function'&&typeof checkSeasons==='function'`)) break; } catch (e) {}
      await sleep(200);
    }
  }
  return call;
}
const pages = async () => (await targets()).filter(t => t.type === 'page').map(t => t.url);

let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log('  ✔', name); }
const until = async (fn, ms = 6000, what = 'condition') => {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timeout: ' + what); await sleep(200); }
};

// ---------- تشغيل 1: ملف تخزين بايظ ----------
const ud1 = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-test-'));
fs.writeFileSync(path.join(ud1, 'storage.json'), '{not json');
let proc = await launch(ud1);
try {
  console.log('run 1: corrupt storage');
  await check('corrupt storage.json is moved aside, not overwritten', async () => {
    const files = fs.readdirSync(ud1);
    assert.ok(files.some(f => /^storage\.corrupt-\d+\.json$/.test(f)), files.join(','));
  });
} finally { proc.kill(); await sleep(1000); }

// ---------- تشغيل 2: نسخة احتياطية متلغّمة ----------
const ud2 = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-test-'));
fs.writeFileSync(path.join(ud2, 'storage.json'), JSON.stringify({
  'watchlist:seeded': '1',
  'watchlist:data': JSON.stringify([
    { id: '"><img src=x id=pwn>', title: 'Evil', type: 'film', status: 'queue', year: '<b id=pwn2>', poster: 'javascript:alert(1)', backdrop: '"><i id=pwn3>' },
    { id: 'ok1', title: 'Good', type: 'tv', status: 'watched', rating: 8, recWhy: '<img src=x id=pwn4>', recFrom: [{}, '<b id=pwn5>', 7] },
    { title: '' },
  ]),
  'watchlist:sites': JSON.stringify([{ name: 'bad', url: 'javascript:alert(1)' }, { name: 'good', url: 'https://example.org/{q}' }]),
  'watchlist:playerTpl': 'javascript:parent.document.title="pwned"',
}));
const dlDir = path.join(ud2, 'dl-test');
fs.writeFileSync(path.join(ud2, 'sitewin.json'), JSON.stringify({ width: 900, height: 650 }));
proc = await launch(ud2, { env: { WL_ADBLOCK_FILTERS: '/wl-ad.gif\n/wl-adpop', WL_DL_DIR: dlDir } });
try {
  console.log('run 2: malicious backup + hostile iframe');
  const app = await conn('app://local/');

  await check('app loads from app://local and storage shim works', async () => {
    assert.equal(await app.ev('location.origin'), 'app://local');
    assert.equal(await app.ev('typeof chrome.storage.local.get'), 'function');
  });
  await check('malicious items are sanitized on load', async () => {
    const r = await app.ev(`({n:items.length, ids:items.map(i=>i.id), poster:items[0].poster, year:items[0].year, bd:items[0].backdrop,
      injected:!!document.querySelector('#pwn,#pwn2,#pwn3')})`);
    assert.equal(r.n, 2);
    assert.ok(r.ids.every(id => /^[\w-]{1,40}$/.test(id)), r.ids.join(','));
    assert.equal(r.poster, null); assert.equal(r.year, null); assert.equal(r.bd, null);
    assert.equal(r.injected, false);
  });
  await check('recommendation reason from a backup is sanitized and rendered as text', async () => {
    const r = await app.ev(`(()=>{const it=items.find(i=>i.id==='ok1');openModal('ok1');
      const out={from:it.recFrom,injected:!!document.querySelector('#pwn4,#pwn5'),shown:$('modal').innerText.includes('<img src=x id=pwn4>')};
      closeModal();return out})()`);
    assert.deepEqual(r, { from: ['<b id=pwn5>'], injected: false, shown: true });
  });
  await check('javascript: sites dropped, javascript: player template rejected', async () => {
    assert.deepEqual(await app.ev('sites.map(s=>s.name)'), ['good']);
    assert.equal(await app.ev(`playerSrv=99; playerSrc({...items[1], tmdbId:1})`), null);
    assert.equal(await app.ev(`(()=>{try{fillUrl('javascript:x',items[1],1);return 'allowed'}catch(e){return e.message}})()`), 'BAD_URL');
  });
  await check('server 4 (vidlink) URLs; adding a server keeps a saved "custom" choice as custom', async () => {
    assert.equal(await app.ev(`fillUrl(PLAYER_SERVERS[3].tpl,{type:'film'},550)`), 'https://vidlink.pro/movie/550');
    assert.equal(await app.ev(`fillUrl(PLAYER_SERVERS[3].tpl,{type:'tv',curSeason:2,curEp:4},1396)`), 'https://vidlink.pro/tv/1396/2/5');
    const r = await app.ev(`JSON.stringify([restorePlayerSrv('3',undefined),restorePlayerSrv('3','4'),restorePlayerSrv('1',undefined),restorePlayerSrv('4','4'),restorePlayerSrv('99','4'),PLAYER_SERVERS.length])`);
    // '3' من غير طول محفوظ = "مخصص" من أيام الـ 3 سيرفرات → يفضل مخصص (4) مش vidlink (3)
    assert.deepEqual(JSON.parse(r), [4, 3, 1, 4, 4, 4]);
  });
  await check('updates section: shows current version; dev build never checks or installs', async () => {
    const r = await app.ev(`(async()=>{const st=await __wlDesktop.update.check();const inst=await __wlDesktop.update.install();
      await new Promise(r=>setTimeout(r,200));
      return {st:st.status,cur:st.current,inst,shown:$('updSec').style.display!=='none',nav:$('updSec').closest('.spage')?.id==='pgAbout',
        txt:$('updStatus').textContent,ver:$('verTxt').textContent,btnDisabled:$('updCheckBtn').disabled}})()`);
    assert.equal(r.st, 'dev'); assert.equal(r.inst, false);
    assert.ok(r.shown && r.nav, 'updates block visible on desktop, inside the about page');
    assert.match(r.txt, /المتثبّتة/); assert.equal(r.ver, 'v' + r.cur); assert.equal(r.btnDisabled, true);
  });
  await check('web guest page uses the exact same server list as the app (same order)', async () => {
    const { SERVERS } = await import(new URL('../party-server/public/guest-logic.mjs', import.meta.url));
    assert.deepEqual(JSON.parse(await app.ev(`JSON.stringify(PLAYER_SERVERS.map(s=>s.tpl))`)), SERVERS);
  });
  await check('app page cannot read local files', async () => {
    const r = await app.ev(`fetch('file:///C:/Windows/win.ini').then(()=>'READ').catch(()=>'blocked')`);
    assert.equal(r, 'blocked');
  });
  await check('CSP blocks inline script injection', async () => {
    const r = await app.ev(`new Promise(r=>{window.__x=0;const d=document.createElement('div');d.innerHTML='<img src=x onerror="window.__x=1">';document.body.appendChild(d);setTimeout(()=>r(window.__x),500)})`);
    assert.equal(r, 0);
  });

  await app.ev(`new Promise(r=>{const f=document.createElement('iframe');f.id='tf';f.style='position:fixed;top:0;left:0;width:600px;height:400px;z-index:99999';f.src='https://example.com';f.onload=r;document.body.appendChild(f)})`);
  await sleep(500);
  const fr = await conn('example.com');
  const click = async () => { for (const type of ['mousePressed', 'mouseReleased']) await fr('Input.dispatchMouseEvent', { type, x: 300, y: 200, button: 'left', clickCount: 1 }); };

  await check('iframe window.open returns a fake window', async () => {
    assert.match(await fr.ev('String(window.open)'), /makeFakeWin/);
  });
  await check('ad link (target=_blank) clicked with real gesture opens nothing', async () => {
    await fr.ev(`window.hits=0;document.body.innerHTML='<a id=ad href="https://example.net/ad" target="_blank" style="position:fixed;inset:0;display:block">AD</a>';ad.onclick=()=>hits++`);
    const before = (await pages()).length;
    await click(); await sleep(1500);
    if ((await fr.ev('hits')) !== 1) {
      const diag = await app.ev(`JSON.stringify({vis:document.visibilityState, focus:document.hasFocus(), top:document.elementFromPoint(300,200)?.id||document.elementFromPoint(300,200)?.className, overlays:[...document.querySelectorAll('.show')].map(e=>e.id)})`);
      assert.fail('click did not reach the link — test invalid. app state: ' + diag);
    }
    assert.equal((await pages()).length, before);
  });
  await check('iframe cannot navigate the app window away (top.location)', async () => {
    await fr.ev(`window.hits=0;document.body.innerHTML='<button id=b style="position:fixed;inset:0">x</button>';b.onclick=()=>{hits++;top.location='https://example.net/hijack'}`);
    await click(); await sleep(1500);
    assert.equal(await fr.ev('hits'), 1);
    assert.equal(await app.ev('location.origin'), 'app://local');
  });
  await check('iframe permissions (geolocation, notifications) are denied', async () => {
    assert.equal(await fr.ev(`navigator.permissions.query({name:'geolocation'}).then(p=>p.state)`), 'denied');
    assert.equal(await fr.ev(`Notification.requestPermission()`), 'denied');
  });
  fr.close();
  await app.ev(`document.getElementById('tf').remove()`);

  await check('app-initiated window.open still opens a window without storage access', async () => {
    const opened = await app.ev(`(()=>{const w=window.open('about:blank','_blank');if(!w)return 'null';w.location='https://example.org';return 'ok'})()`);
    assert.equal(opened, 'ok', 'window.open returned null — the app blocked its own window');
    // موقع خارجي — نستنى لحد 10 ثواني بدل وقت ثابت (الشبكة على GitHub Actions أبطأ أحياناً)
    let urls = [];
    for (let i = 0; i < 50 && !urls.some(u => u.startsWith('https://example.org')); i++) { await sleep(200); urls = await pages(); }
    assert.ok(urls.some(u => u.startsWith('https://example.org')), 'pages: ' + JSON.stringify(urls));
    const child = await conn('example.org');
    assert.equal(await child.ev('typeof (window.chrome && chrome.storage)'), 'undefined');
    child.close();
  });
  await check('ad blocking: site windows block ad requests; the shield toggle turns it off for that site only', async () => {
    const hits = {};
    const srv = http.createServer((req, res) => {
      const p = req.url.split('?')[0]; hits[p] = (hits[p] || 0) + 1;
      res.writeHead(200, { 'Content-Type': p === '/site' ? 'text/html' : 'image/gif', 'Cache-Control': 'no-store' });
      res.end(p === '/site' ? '<img src="/wl-ad.gif"><img src="/ok.gif">' : '');
    });
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    try {
      const url = `http://127.0.0.1:${srv.address().port}/site?q={q}`;
      await app.ev(`sites=[{name:'T',url:${JSON.stringify(url)}}];sset('watchlist:sites',JSON.stringify(sites)).then(()=>openWatch('ok1',0)).then(()=>1)`);
      await until(() => hits['/ok.gif'] >= 1, 10000, 'site page loaded');
      await sleep(500);
      assert.equal(hits['/wl-ad.gif'], undefined, 'ad request reached the server');
      await app.ev(`siteBlock(0).then(()=>openWatch('ok1',0)).then(()=>1)`);
      assert.equal(await app.ev(`document.querySelector('#sitesList [data-act=siteBlock]').getAttribute('aria-pressed')`), 'false');
      await until(() => hits['/ok.gif'] >= 2, 10000, 'site page loaded again');
      await until(() => hits['/wl-ad.gif'] === 1, 3000, 'ad allowed once the site is excluded');
      // المفتاح العام: الموقع رجع محمي، بس الحظر مقفول لكل المواقع → الإعلان يعدّي. ونرجّعه
      await app.ev(`siteBlock(0).then(()=>toggleAdblock()).then(()=>openWatch('ok1',0)).then(()=>1)`);
      assert.equal(await app.ev(`$('adblockBtn').getAttribute('aria-checked')`), 'false');
      await until(() => hits['/ok.gif'] >= 3, 10000, 'site page loaded a third time');
      await until(() => hits['/wl-ad.gif'] === 2, 3000, 'ad allowed with the global switch off');
      await app.ev(`toggleAdblock().then(()=>1)`);
      assert.equal(await app.ev(`chrome.storage.local.get('watchlist:adblock').then(d=>d['watchlist:adblock'])`), '1');
    } finally { srv.close(); }
  });
  {
    // سيرفر تنزيلات محلي: WAV صامت 15 دقيقة (بيتشغّل في <video>)، exe، وملف بطيء للإيقاف/الاستكمال
    const sr = 8000, secs = 900, n = sr * secs, wav = Buffer.alloc(44 + n * 2);
    wav.write('RIFF', 0); wav.writeUInt32LE(36 + n * 2, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(sr, 24); wav.writeUInt32LE(sr * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(n * 2, 40);
    const SLOW = 40 * 65536;
    let adpop = 0;
    const srv = http.createServer((req, res) => {
      const att = name => ({ 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${name}"` });
      if (req.url === '/con.wav') { res.writeHead(200, { ...att('CON.wav'), 'Content-Length': wav.length }); return res.end(wav); }
      if (req.url.split('?')[0] === '/dlpage') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<a id=file href="/popfile.wav" target=_blank>Download</a><a id=ad href="/wl-adpop" target=_blank>AD</a>'); }
      if (req.url === '/wl-adpop') { adpop++; res.writeHead(200); return res.end('ad'); }
      if (req.url === '/popfile.wav') { res.writeHead(200, { ...att('popfile.wav'), 'Content-Length': 44 }); return res.end(wav.subarray(0, 44)); }
      if (req.url === '/evil.exe') { res.writeHead(200, { ...att('evil.exe'), 'Content-Length': 2 }); return res.end('MZ'); }
      if (req.url.split('?')[0] === '/ep.wav') { res.writeHead(200, { ...att('ep.wav'), 'Content-Length': wav.length }); return res.end(wav); }
      if (req.url === '/movie.mp4') { res.writeHead(200, { ...att('movie.mp4'), 'Content-Type': 'application/x-msdownload', 'Content-Length': 2 }); return res.end('MZ'); }
      if (req.url === '/slow.mp4' || req.url === '/nope.mp4') {
        res.writeHead(200, { ...att(req.url.slice(1)), 'Content-Length': SLOW });
        let i = 0; const t = setInterval(() => { res.write(Buffer.alloc(65536)); if (++i === 40) { clearInterval(t); res.end(); } }, 150);
        res.on('close', () => clearInterval(t)); return;
      }
      res.writeHead(404); res.end();
    });
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${srv.address().port}`;
    const st = () => app.ev(`__wlDesktop.dl.state()`);
    const siteOpen = url => app.ev(`(()=>{const w=window.open('about:blank','_blank');w.location=${JSON.stringify(url)};return 1})()`);
    const item = async name => (await st()).items.find(i => i.name === name);
    // كل تنزيل بيستنى موافقة: الاسم + الحجم + الموقع في نافذة التأكيد بتاعة البرنامج
    const approve = async (name, yes = true) => {
      const msg = await until(() => app.ev(`$('confirmOverlay').classList.contains('show')&&$('confirmMsg').textContent.includes(${JSON.stringify(name)})&&$('confirmMsg').textContent`), 8000, 'confirm for ' + name);
      await app.ev(`document.getElementById('${yes ? 'confirmYes' : 'confirmNo'}').click();1`);
      return msg;
    };
    try {
      await check('downloads: site-window download saved to the folder (reserved name made safe); .exe blocked', async () => {
        await siteOpen(base + '/con.wav');
        await until(async () => (await item('_CON.wav'))?.state === 'confirm', 8000, 'waiting for approval');
        await sleep(800);
        assert.equal((await item('_CON.wav')).state, 'confirm', 'nothing downloads before approval');
        const msg = await approve('_CON.wav');
        assert.match(msg, /14\.4 MB/); assert.match(msg, /127\.0\.0\.1/);
        await until(async () => (await item('_CON.wav'))?.state === 'completed', 15000, 'wav downloaded');
        assert.equal(fs.statSync(path.join(dlDir, '_CON.wav')).size, wav.length);
        await siteOpen(base + '/evil.exe');
        await sleep(2000);
        assert.equal(fs.existsSync(path.join(dlDir, 'evil.exe')), false);
        assert.equal(await item('evil.exe'), undefined);
        // exe متنكر في اسم فيلم (السيرفر نفسه بيقول إنه برنامج)
        await siteOpen(base + '/movie.mp4');
        await sleep(2000);
        assert.equal(await item('movie.mp4'), undefined);
        assert.equal(fs.existsSync(path.join(dlDir, 'movie.mp4')), false);
      });
      await check('downloads: saying no cancels it — nothing saved; tiny "video" gets a warning', async () => {
        await siteOpen(base + '/nope.mp4');
        const msg = await approve('nope.mp4', false);
        assert.match(msg, /صغير/);
        await until(async () => (await item('nope.mp4'))?.state === 'cancelled', 5000, 'cancelled');
        await sleep(500);
        assert.equal(fs.readdirSync(dlDir).some(n => n.startsWith('nope')), false, fs.readdirSync(dlDir).join(','));
      });
      await check('site windows: download links that open a new window work; known ad popups are denied', async () => {
        // التشيك اللي فات قفل الحظر لـ 127.0.0.1 (نفس السيرفر ده) — نرجّعه
        await app.ev(`sites=[];sset('watchlist:sites','[]').then(()=>1)`);
        await siteOpen(base + '/dlpage');
        const page = await until(async () => { try { return await conn('/dlpage'); } catch (e) { return null; } }, 8000, 'download page');
        const click = id => page('Runtime.evaluate', { expression: `document.getElementById('${id}').click()`, userGesture: true });
        await click('ad'); await sleep(1500);
        assert.equal(adpop, 0, 'ad popup was opened');
        await click('file');
        await approve('popfile.wav');
        await until(async () => (await item('popfile.wav'))?.state === 'completed', 8000, 'download from a new-window link');
        // نوافذ المواقع بتفتح بآخر مقاس اتساب عليه (sitewin.json اتحط قبل التشغيل — Electron مبيدعمش تغيير المقاس من CDP)
        assert.equal(await page.ev(`innerWidth`), 900);
        // الشريط اللي فوق (sitebar.html) بشكل البرنامج: أوامر نافذته بس — مفيش تخزين ولا APIs الواجهة
        const bar = await conn('sitebar.html');
        assert.deepEqual(JSON.parse(await bar.ev(`JSON.stringify([typeof __wlBar, typeof (window.chrome&&chrome.storage), typeof __wlDesktop, typeof __wlAi, document.getElementById('host').textContent])`)),
          ['object', 'undefined', 'undefined', 'undefined', '127.0.0.1']);
        bar.close();
        page.close();
      });
      await check('downloads: pause stops progress, resume finishes', async () => {
        await siteOpen(base + '/slow.mp4');
        await approve('slow.mp4');
        await until(async () => (await item('slow.mp4'))?.received > 0, 8000, 'slow started');
        await until(async () => (await item('slow.mp4'))?.speed > 0, 5000, 'speed measured');
        await app.ev(`dlOpen();1`);
        await until(() => app.ev(`(t=>t.includes('/s')&&t.includes('فاضل'))(document.getElementById('dlBody').innerText)`), 4000, 'speed + time left shown');
        await app.ev(`dlClose();1`);
        const id = (await item('slow.mp4')).id;
        assert.equal(await app.ev(`__wlDesktop.dl.act(${id},'pause')`), true);
        await until(async () => (await item('slow.mp4')).state === 'paused', 3000, 'paused');
        const r1 = (await item('slow.mp4')).received; await sleep(1000);
        assert.equal((await item('slow.mp4')).received, r1, 'no progress while paused');
        assert.equal(await app.ev(`__wlDesktop.dl.act(${id},'resume')`), true);
        await until(async () => (await item('slow.mp4')).state === 'completed', 15000, 'slow completed');
        assert.equal(fs.statSync(path.join(dlDir, 'slow.mp4')).size, SLOW);
      });
      await check('library: plays in-app with seeking (range requests); tampered links refused', async () => {
        await app.ev(`dlOpen();1`);
        await until(() => app.ev(`!!document.querySelector('#dlBody [data-act=dlPlay]')`), 4000, 'library listed');
        const names = await app.ev(`dl.library.map(f=>f.name).join(',')`);
        assert.match(names, /_CON\.wav/); assert.match(names, /slow\.mp4/);
        await app.ev(`document.querySelectorAll('#dlBody [data-act=dlPlay]')[dl.library.findIndex(f=>f.name==='_CON.wav')].click();1`);
        await until(() => app.ev(`(v=>v&&v.duration>800)(document.getElementById('dlVideo'))`), 8000, 'video metadata');
        await app.ev(`(v=>{v.pause();v.currentTime=600})(document.getElementById('dlVideo'));1`);
        await until(() => app.ev(`(v=>!v.seeking&&Math.abs(v.currentTime-600)<1)(document.getElementById('dlVideo'))`), 5000, 'seeked to 10:00');
        const url = await app.ev(`document.getElementById('dlVideo').src`);
        for (const bad of [url.replace(/lib\/[0-9a-f]+\//, 'lib/' + '0'.repeat(32) + '/'), url.replace(/[^/]+$/, '..%2Fstorage.json'), url.replace(/[^/]+$/, 'x.exe')]) {
          const err = await app.ev(`new Promise(r=>{const v=document.createElement('video');v.onerror=()=>r('refused');v.onloadedmetadata=()=>r('loaded');v.src=${JSON.stringify(bad)};setTimeout(()=>r('timeout'),4000)})`);
          assert.equal(err, 'refused', bad);
        }
        await app.ev(`dlClose();1`);
        assert.equal(await app.ev(`document.getElementById('lp').hidden&&!document.getElementById('dlVideo').getAttribute('src')`), true, 'closing hides the player and stops the video');
      });
      await check('library: a subtitle file next to the video loads (srt → vtt, Windows-1256 Arabic)', async () => {
        fs.writeFileSync(path.join(dlDir, 'Sub Movie.wav'), wav);
        const ar = Buffer.from([0xE3, 0xD1, 0xCD, 0xC8, 0xC7]); // "مرحبا" بـ Windows-1256
        fs.writeFileSync(path.join(dlDir, 'Sub Movie.ar.srt'), Buffer.concat([Buffer.from('1\r\n00:00:01,000 --> 00:00:05,000\r\n'), ar, Buffer.from('\r\n\r\n')]));
        await app.ev(`dlOpen();dlRefresh().then(()=>1)`);
        const f = await app.ev(`JSON.stringify(dl.library.find(f=>f.name==='Sub Movie.wav'))`).then(JSON.parse);
        assert.deepEqual(f.subs.map(s => s.label), ['ar']);
        await app.ev(`dlPlayFile(dl.library.find(f=>f.name==='Sub Movie.wav'));document.querySelector('#dlVideo track').track.mode='showing';1`);
        const cue = await until(() => app.ev(`(t=>t&&t.cues&&t.cues.length?t.cues[0].text:'')(document.querySelector('#dlVideo track').track)`), 8000, 'subtitle cues');
        assert.equal(cue, 'مرحبا');
        await app.ev(`dlClose();1`);
      });
      await check('library: a download from a title page is linked to it; local playback tracks the episode and really resumes', async () => {
        await app.ev(`items.push(cleanItem({id:'lib1',title:'Lib Show',type:'tv',status:'watching',tmdbId:55,curSeason:1,curEp:2}));
          sites=[{name:'L',url:${JSON.stringify(base + '/ep.wav?q={q}')},dl:true}];openWatch('lib1',0).then(()=>1)`);
        await approve('ep.wav');
        await until(async () => (await item('ep.wav'))?.state === 'completed', 15000, 'episode downloaded');
        await app.ev(`dlOpen();1`);
        await until(() => app.ev(`dl.library.some(f=>f.name==='ep.wav')`), 4000, 'in library');
        assert.match(await app.ev(`document.getElementById('dlBody').innerText`), /Lib Show\s+S01E03/);
        // شارة "متحمّل" على كارت العنوان في الصفحة الرئيسية
        assert.equal(await app.ev(`tab='watching';render();!!document.querySelector('[data-itemid="lib1"] .dlb')`), true, 'downloaded badge on the card');
        await app.ev(`tab='queue';render();1`);
        // نقدّم لـ 5:00 → مكان الوقوف يتحفظ على S01E03
        await app.ev(`dlPlayFile(dl.library.find(f=>f.name==='ep.wav'));1`);
        await until(() => app.ev(`(v=>v&&v.duration>800)(document.getElementById('dlVideo'))`), 8000, 'metadata');
        // البلاير على الشاشة كلها باسم العنوان والحلقة
        assert.deepEqual(JSON.parse(await app.ev(`JSON.stringify([document.getElementById('lp').hidden,$('lpTitle').textContent,/S01E03/.test($('lpSub').textContent)])`)), [false, 'Lib Show', true]);
        await app.ev(`(v=>{v.pause();v.currentTime=300})(document.getElementById('dlVideo'));1`);
        await until(async () => (await app.ev(`JSON.stringify(items.find(i=>i.id==='lib1').resume||null)`)).includes('"pos":300'), 5000, 'resume saved');
        // "كمّل" من الصفحة الرئيسية بيشغّل الملف المحلي ويقدّم لنفس الثانية
        await app.ev(`dlClose();render();document.querySelector('#cwList [data-act=cwPlay][data-id=lib1]').click();1`);
        await until(() => app.ev(`(v=>v&&Math.abs(v.currentTime-300)<2)(document.getElementById('dlVideo'))`), 8000, 'resumed at 5:00');
        // 90% → الحلقة اتعلّمت والعدّاد اتقدم
        await app.ev(`(v=>{v.pause();v.currentTime=820})(document.getElementById('dlVideo'));1`);
        await until(() => app.ev(`items.find(i=>i.id==='lib1').curEp===3`), 5000, 'episode marked watched');
        await app.ev(`dlClose();1`);
      });
    } finally { srv.close(); }
  }
  await check('in-app confirm instead of Windows dialogs: cancel keeps, confirm deletes', async () => {
    await app.ev(`items.push(cleanItem({id:'tmpdel',title:'Temp',type:'film',status:'queue'}));1`);
    const p1 = app.ev(`del('tmpdel').then(()=>1)`);
    await sleep(300);
    assert.deepEqual(JSON.parse(await app.ev(`JSON.stringify({shown:$('confirmOverlay').classList.contains('show'),msg:$('confirmMsg').textContent})`)), { shown: true, msg: 'متأكد إنك عايز تمسحه من القايمة؟' });
    await app.ev(`$('confirmNo').click();1`); await p1;
    assert.equal(await app.ev(`items.some(i=>i.id==='tmpdel')`), true, 'cancel keeps the item');
    const p2 = app.ev(`del('tmpdel').then(()=>1)`);
    await sleep(300);
    await app.ev(`$('confirmYes').click();1`); await p2;
    assert.equal(await app.ev(`items.some(i=>i.id==='tmpdel')`), false);
    assert.equal(await app.ev(`$('confirmOverlay').classList.contains('show')`), false);
  });
  await check('removed: edit button + old form, list view toggle', async () => {
    const r = await app.ev(`(()=>{openModal(items[0].id);const h=$('modal').innerHTML;closeModal();
      return {edit:/data-act="edit"/.test(h),addBox:!!document.getElementById('addBox'),viewBtn:!!document.getElementById('viewBtn'),wall:$('list').className}})()`);
    assert.deepEqual(r, { edit: false, addBox: false, viewBtn: false, wall: r.wall });
    assert.notEqual(r.wall, 'rows');
  });
  await check('external links: only the GitHub account is allowed out of the app', async () => {
    for (const u of ['https://evil.example/x', 'file:///C:/Windows/System32/calc.exe', 'https://github.com.evil.io/Gasser-hafez', 'https://github.com/other', 'ms-settings:']) {
      assert.equal(await app.ev(`__wlDesktop.openExternal(${JSON.stringify(u)})`), false, u);
    }
  });
  await check('Rotten Tomatoes: parsed from OMDb Ratings, validated, shown next to IMDb', async () => {
    const r = await app.ev(`JSON.stringify([
      rtOf({Ratings:[{Source:'Internet Movie Database',Value:'8.8/10'},{Source:'Rotten Tomatoes',Value:'94%'}]}),
      rtOf({Ratings:[{Source:'Rotten Tomatoes',Value:'<b>1</b>'}]}), rtOf({}), rtOf({Ratings:[{Source:'Rotten Tomatoes',Value:'150%'}]}),
      cleanItem({title:'x',rt:87}).rt, cleanItem({title:'x',rt:'150'}).rt, cleanItem({title:'x',rt:'"><img>'}).rt])`);
    assert.deepEqual(JSON.parse(r), [94, null, null, null, 87, null, null]);
    await app.ev(`items.push(cleanItem({id:'rt1',title:'RT Film',type:'film',status:'queue',imdb:8.1,rt:87,rtChecked:true}));tab='queue';render();1`);
    assert.match(await app.ev(`document.querySelector('[data-itemid="rt1"]').textContent`), /🍅 87%/);
    // RT باين في "شفتها" كمان (IMDb لأ — الكارت فيه تقييمك)
    await app.ev(`items.push(cleanItem({id:'rt2',title:'RT Seen',type:'film',status:'watched',rating:7,imdb:8.1,rt:91,rtChecked:true}));tab='watched';render();1`);
    const seen = await app.ev(`document.querySelector('[data-itemid="rt2"] .pyear').textContent`);
    assert.match(seen, /🍅 91%/); assert.doesNotMatch(seen, /8\.1/);
    await app.ev(`tab='queue';render();1`);
  });
  await check('download sites: own "download from" section (default + added), not mixed with watch sites; TV default link has the episode', async () => {
    const r = await app.ev(`(async()=>{sites=[{name:'W1',url:'https://w.example/{tmdbID}'}];$('siteKind').value='dl';$('siteName').value='D1';$('siteUrl').value='https://d.example/{type}/{tmdbID}';await addSite();
      items.push(cleanItem({id:'dl1',title:'DL Show',type:'tv',status:'watching',tmdbId:77,curSeason:2,curEp:4}));openModal('dl1');
      const secs=[...document.querySelectorAll('#modal .msec')].map(s=>s.innerText.replace(/\\s+/g,' '));
      const u=fillUrl($('dlTpl').value,items.find(i=>i.id==='dl1'),77);closeModal();
      return {saved:JSON.parse(await sget('watchlist:sites')).find(s=>s.name==='D1'),secs,u}})()`);
    assert.deepEqual(r.saved, { name: 'D1', url: 'https://d.example/{type}/{tmdbID}', dl: true });
    const watch = r.secs.find(s => /اتفرج على موقع/.test(s)), dl = r.secs.find(s => /حمّل من/.test(s));
    assert.match(watch, /W1/); assert.doesNotMatch(watch, /D1/);
    assert.match(dl, /D1/); assert.match(dl, /nxsha/);
    assert.equal(r.u, 'https://web.nxsha.app/dl/tv/77/2/5');
  });
  app.close();
} finally { proc.kill(); }

// ---------- تشغيل 3: إشعارات المواسم الجديدة (TMDB متزيّف عن طريق CDP) ----------
const ud3 = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-test-'));
const tv = (id, title, status, extra = {}) => ({ id, title, type: 'tv', status, tmdbId: Number(id.slice(1)), ...extra });
fs.writeFileSync(path.join(ud3, 'storage.json'), JSON.stringify({
  'watchlist:seeded': '1',
  'watchlist:tmdbkey': 'test-key',
  'watchlist:lastSeasonCheck': String(Date.now()), // الفحص اللي وقت الفتح ميشتغلش قبل ما نجهّز الـ mock
  'watchlist:data': JSON.stringify([
    tv('s100', 'Show A', 'watched', { lastKnownSeasons: 2 }),  // نزل موسم 3 → إشعار
    tv('s200', 'Show B', 'watching', { lastKnownSeasons: 5 }), // بيانات قديمة: موسم 5 متعلن بس → يرجع لـ 4 من غير إشعار
    tv('s300', 'Show C', 'watched'),                            // أول مرة → يتسجل من غير إشعار
    tv('s400', 'Show D', 'queue', { lastKnownSeasons: 1 }),    // "هشوفهم" مبيتفحصش
  ]),
}));
const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const seasons = (aired, future = 0) => [
  { season_number: 0, air_date: day(-1) }, // حلقات خاصة — متتحسبش
  ...Array.from({ length: aired }, (_, i) => ({ season_number: i + 1, air_date: day(-400 + i * 30) })),
  ...Array.from({ length: future }, (_, i) => ({ season_number: aired + i + 1, air_date: day(90) })),
];
const TMDB = { 100: { seasons: seasons(3) }, 200: { seasons: seasons(4, 1) }, 300: { seasons: seasons(2) }, 400: { seasons: seasons(9) } };
proc = await launch(ud3);
try {
  console.log('run 3: new-season notifications');
  const app = await conn('app://local/');
  let tmdbMode = 'ok';
  const tmdbHits = [];
  app.on('Fetch.requestPaused', ({ requestId, request }) => {
    if (request.url.startsWith('https://vsembed.ru/')) { // بلاير مزيف: بيبعت PLAYER_EVENT زي vsembed لما التست يقوله
      return app('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/html' }],
        body: Buffer.from(`<script>addEventListener('message',e=>{const d=e.data;if(d&&d.fake)parent.postMessage({type:'PLAYER_EVENT',data:{player_status:d.fake,player_progress:d.pos,player_duration:d.dur||2700,...(d.info?{player_info:d.info}:{})}},'*')})</script>`).toString('base64') });
    }
    if (tmdbMode === 'offline') return app('Fetch.failRequest', { requestId, errorReason: 'InternetDisconnected' });
    const id = (request.url.match(/\/tv\/(\d+)/) || [])[1];
    let json, ok;
    if (request.url.startsWith('https://www.omdbapi.com/')) { // OMDb: تقييم RT لأي رقم IMDb
      json = { Response: 'True', imdbRating: '7.4', Ratings: [{ Source: 'Internet Movie Database', Value: '7.4/10' }, { Source: 'Rotten Tomatoes', Value: '77%' }] }; ok = true;
    } else if (request.url.includes('/external_ids')) { // رقم IMDb للعناصر اللي جت من TMDB بس
      json = { imdb_id: id === '400' ? null : 'tt900' + id }; ok = true;
    } else { tmdbHits.push(id); json = TMDB[id] || {}; ok = !!TMDB[id]; }
    const body = Buffer.from(JSON.stringify(json)).toString('base64');
    app('Fetch.fulfillRequest', {
      requestId, responseCode: ok ? 200 : 404, body,
      responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }],
    });
  });
  await app('Fetch.enable', { patterns: [{ urlPattern: 'https://api.themoviedb.org/*' }, { urlPattern: 'https://www.omdbapi.com/*' }, { urlPattern: 'https://vsembed.ru/*' }] });
  // spy بدل الإشعار الحقيقي عشان التست ميطلعش إشعارات على الجهاز
  await app.ev(`window.__notes=[]; notifyDesktop=p=>{__notes.push(p)}; 1`);
  const runCheck = () => app.ev(`chrome.storage.local.set({'watchlist:lastSeasonCheck':'0'}).then(()=>checkSeasons()).then(()=>1)`);

  await check('aired season detected → one notification for that show', async () => {
    await runCheck();
    const notes = await app.ev('__notes');
    assert.equal(notes.length, 1, JSON.stringify(notes));
    assert.equal(notes[0].itemId, 's100');
    assert.match(notes[0].body, /Show A.*3/);
    assert.ok(!tmdbHits.includes('400'), 'queue shows must not be checked');
  });
  await check('announced-only season and first-seen show do not notify; legacy count clamped', async () => {
    const r = await app.ev(`Object.fromEntries(items.map(i=>[i.id,{n:i.newSeason,last:i.lastKnownSeasons,latest:i.latestSeasons}]))`);
    assert.deepEqual(r.s100, { n: true, last: 2, latest: 3 });
    assert.deepEqual(r.s200, { n: false, last: 4, latest: 4 });
    assert.deepEqual(r.s300, { n: false, last: 2, latest: 2 });
  });
  await check('flag persisted to storage, re-check does not notify twice', async () => {
    const saved = await app.ev(`chrome.storage.local.get('watchlist:data').then(d=>JSON.parse(d['watchlist:data']).find(i=>i.id==='s100').newSeason)`);
    assert.equal(saved, true);
    await runCheck();
    assert.equal((await app.ev('__notes')).length, 1);
  });
  await check('announced season that airs later notifies', async () => {
    await app.ev(`ackSeason('s100').then(()=>1)`);
    TMDB[200] = { seasons: seasons(5) };
    await runCheck();
    const notes = await app.ev('__notes');
    assert.equal(notes.length, 2, JSON.stringify(notes));
    assert.equal(notes[1].itemId, 's200');
  });
  await check('multiple new seasons → single summary notification', async () => {
    TMDB[100] = { seasons: seasons(4) }; TMDB[300] = { seasons: seasons(3) };
    await runCheck();
    const notes = await app.ev('__notes');
    assert.equal(notes.length, 3, JSON.stringify(notes));
    assert.equal(notes[2].itemId, undefined);
    assert.match(notes[2].title, /2/);
  });
  await check('episode dates: next episode on the card; a newly aired episode notifies once (first sight is silent)', async () => {
    TMDB[200] = { seasons: seasons(5), next_episode_to_air: { season_number: 5, episode_number: 4, air_date: day(2) }, last_episode_to_air: { season_number: 5, episode_number: 3, air_date: day(-1) } };
    await runCheck();
    const r = JSON.parse(await app.ev(`JSON.stringify((i=>({n:i.nextEp,k:i.epNotified}))(items.find(i=>i.id==='s200')))`));
    assert.deepEqual(r, { n: { s: 5, e: 4, date: day(2) }, k: '5x3' });
    const epNotes = async () => (await app.ev('__notes')).filter(n => /حلقة/.test(n.title));
    assert.equal((await epNotes()).length, 0, 'first sight is silent');
    await app.ev(`tab='watching';render();1`);
    assert.match(await app.ev(`document.querySelector('[data-itemid="s200"] .nextep').textContent`), /E04/);
    TMDB[200] = { seasons: seasons(5), next_episode_to_air: { season_number: 5, episode_number: 5, air_date: day(9) }, last_episode_to_air: { season_number: 5, episode_number: 4, air_date: day(0) } };
    await runCheck(); await runCheck();
    const eps = await epNotes();
    assert.equal(eps.length, 1, JSON.stringify(eps));
    assert.match(eps[0].body, /Show B — S05E04/); assert.equal(eps[0].itemId, 's200');
    await app.ev(`tab='queue';render();1`);
  });
  await check('quick add from search, then undo from the same row', async () => {
    TMDB[500] = { seasons: seasons(1), name: 'Quick Show' };
    const r = await app.ev(`(async()=>{qaRows.set('t500',{key:'t500',src:'tmdb',tv:true,tmdbId:500,title:'Quick Show',year:'2020',poster:null,posterBig:null,backdrop:null,desc:''});
      await qaAdd('t500','queue');
      const it=items.find(i=>i.tmdbId===500);
      const acts=qaActsHtml(qaRows.get('t500'),it);
      await qaUndo('t500');
      const saved=await chrome.storage.local.get('watchlist:data');
      return {added:!!it,undoBtn:/data-act="qaUndo"/.test(acts),gone:!items.some(i=>i.tmdbId===500),
        savedGone:!JSON.parse(saved['watchlist:data']).some(i=>i.tmdbId===500),afterActs:qaActsHtml(qaRows.get('t500'),null)}})()`);
    assert.equal(r.added, true); assert.equal(r.undoBtn, true);
    assert.equal(r.gone, true); assert.equal(r.savedGone, true);
    assert.match(r.afterActs, /data-act="qaAdd"/, 'row offers add again');
    // عنصر كان في القايمة من قبل: مفيش تراجع سريع (منمسحش حاجة قديمة بالغلط)
    assert.doesNotMatch(await app.ev(`qaActsHtml({key:'x',title:'Show A'},items.find(i=>i.id==='s100'))`), /qaUndo/);
  });
  await check('Rotten Tomatoes backfill: TMDB-only items get an IMDb id first, then the RT rating', async () => {
    const r = JSON.parse(await app.ev(`rtBackfill().then(()=>JSON.stringify(Object.fromEntries(items.map(i=>[i.id,{imdbID:i.imdbID,rt:i.rt,checked:i.rtChecked}]))))`));
    assert.deepEqual(r.s100, { imdbID: 'tt900100', rt: 77, checked: true });
    assert.deepEqual(r.s400, { imdbID: null, rt: null, checked: true }, 'no IMDb id anywhere → marked checked, not retried');
    const saved = await app.ev(`chrome.storage.local.get('watchlist:data').then(d=>JSON.parse(d['watchlist:data']).find(i=>i.id==='s200').rt)`);
    assert.equal(saved, 77);
  });
  // تتبع الحلقات: البلاير المزيف على vsembed.ru بيبعت مكانه ومدته
  const frame = `document.querySelector('.playerbox iframe')`;
  const fakeEv = (status, pos) => app.ev(`${frame}?.contentWindow.postMessage({fake:${JSON.stringify(status)},pos:${pos}},'*');1`);
  const itemOf = id => app.ev(`JSON.stringify(items.find(i=>i.id==='${id}'))`).then(JSON.parse);
  const openFake = async (it) => {
    await app.ev(`items.push(cleanItem(${JSON.stringify(it)}));playerSrv=0;openPlayer('${it.id}').then(()=>1)`);
    // لحد ما الصفحة المزيفة تتحمّل وترد
    await until(async () => { await fakeEv('playing', 120); return (await itemOf(it.id)).resume?.pos === 120; }, 8000, 'fake player answers');
  };
  await check('auto-track: resume position saved from player events (episode + position)', async () => {
    await openFake({ id: 's600', title: 'Show F', type: 'tv', status: 'watching', tmdbId: 600, imdbID: 'tt600', curSeason: 2, curEp: 3, seasonEps: { 1: 10, 2: 4 }, totalSeasons: 3 });
    const saved = await app.ev(`chrome.storage.local.get('watchlist:data').then(d=>JSON.parse(d['watchlist:data']).find(i=>i.id==='s600').resume)`);
    const { at, ...rest } = saved;
    assert.deepEqual(rest, { s: 2, e: 4, pos: 120, dur: 2700 });
    assert.ok(Math.abs(Date.now() - at) < 60000, 'saved time');
  });
  await check('auto-track: messages not from the player iframe are ignored', async () => {
    await app.ev(`window.postMessage({type:'PLAYER_EVENT',data:{player_status:'playing',player_progress:2650,player_duration:2700}},'*');1`);
    await sleep(500);
    const it = await itemOf('s600');
    assert.deepEqual([it.curSeason, it.curEp], [2, 3]);
  });
  await check('auto-track: 90% marks the episode, last of season → next season; player not reloaded; counted once', async () => {
    const src = await app.ev(`${frame}.src`);
    await fakeEv('playing', 2450);
    await until(async () => (await itemOf('s600')).curSeason === 3, 4000, 'advanced');
    let it = await itemOf('s600');
    assert.deepEqual([it.curSeason, it.curEp, it.resume], [3, 0, undefined]);
    assert.equal(await app.ev(`${frame}.src`), src, 'still showing the credits of the same episode');
    assert.match(await app.ev(`document.querySelector('.pbar [data-act=playerNext]').textContent`), /شغّل الجاية/);
    await fakeEv('playing', 2600); await sleep(500);
    it = await itemOf('s600');
    assert.deepEqual([it.curSeason, it.curEp], [3, 0], 'no double count');
    // "شغّل الجاية" بيحمّل S3E1 من غير ما يعدّ تاني
    await app.ev(`document.querySelector('.pbar [data-act=playerNext]').click();1`);
    await until(() => app.ev(`${frame}.src.includes('season=3&episode=1')`), 4000, 'next episode loaded');
    assert.equal((await itemOf('s600')).curEp, 0);
  });
  await check('auto-track: film in queue → watched at 90%; short ad videos ignored', async () => {
    await openFake({ id: 'f700', title: 'Film G', type: 'film', status: 'queue', tmdbId: 700, imdbID: 'tt700' });
    await app.ev(`${frame}.contentWindow.postMessage({fake:'playing',pos:29,dur:30},'*');1`);
    await sleep(500);
    assert.equal((await itemOf('f700')).status, 'queue', '30s ad does not count');
    await fakeEv('playing', 2500);
    await until(async () => (await itemOf('f700')).status === 'watched', 4000, 'film watched');
  });
  await check('auto-track: custom server without {episode} — the episode the player reports is what counts', async () => {
    // زي إعدادات المستخدم: سيرفر مخصص من غير موسم/حلقة، والحلقة بتتختار من جوه البلاير
    await app.ev(`$('playerTpl').value='https://vsembed.ru/embed/{type}/{tmdbID}';1`);
    const info = (e, tmdb = 650) => JSON.stringify({ tmdb: String(tmdb), mediaType: 'tv', season: 1, episode: e });
    const ev = (pos, e, tmdb) => app.ev(`${frame}.contentWindow.postMessage({fake:'playing',pos:${pos},info:${info(e, tmdb)}},'*');1`);
    await app.ev(`items.push(cleanItem({id:'s650',title:'Show H',type:'tv',status:'watching',tmdbId:650,imdbID:'tt650',curSeason:1,curEp:1}));playerSrv=PLAYER_SERVERS.length;openPlayer('s650').then(()=>1)`);
    assert.equal(await app.ev(`${frame}.src.includes('episode')`), false);
    await until(async () => { await ev(120, 5); return (await itemOf('s650')).resume?.e === 5; }, 8000, 'resume for S1E5');
    const { at, ...rest } = (await itemOf('s650')).resume;
    assert.deepEqual(rest, { s: 1, e: 5, pos: 120, dur: 2700 });
    await ev(2450, 5);
    await until(async () => (await itemOf('s650')).curEp === 5, 4000, 'counter jumps to E5 watched');
    await ev(2600, 6, 999); await sleep(500);
    assert.equal((await itemOf('s650')).curEp, 5, 'event for another title ignored');
    await ev(2600, 3); await sleep(500);
    assert.equal((await itemOf('s650')).curEp, 5, 'rewatching an old episode does not move the counter back');
    await app.ev(`playerSrv=0;$('playerTpl').value='';closeModal();1`);
  });
  await check('watch time: counted only while the video plays (seeks ignored), shown in stats', async () => {
    await app.ev(`items.push(cleanItem({id:'s660',title:'Show Timer',type:'tv',status:'watching',tmdbId:660,imdbID:'tt660',curSeason:1,curEp:0}));playerSrv=0;openPlayer('s660').then(()=>1)`);
    await until(async () => { await fakeEv('playing', 100); return (await itemOf('s660')).resume?.pos === 100; }, 8000, 'fake player answers');
    for (const p of [125, 150, 175, 1000, 1010]) { await fakeEv('playing', p); await sleep(150); } // 1000 = تقديم، مش مشاهدة
    await fakeEv('paused', 1010); await sleep(300);
    const secs = await app.ev(`Math.round(wt.items.s660)`);
    assert.equal(secs, 85, 'three 25s steps + 10s; the jump to 1000 not counted');
    await app.ev(`closeModal();closeStats();openStats();1`);
    const sec = await app.ev(`document.getElementById('wtSec').innerText.replace(/\\s+/g,' ')`);
    assert.match(sec, /Show Timer/); assert.match(sec, /1 د|2 د/);
    assert.match(await app.ev(`chrome.storage.local.get('watchlist:watchtime').then(d=>d['watchlist:watchtime']||'')`), /"s660":85/);
    await app.ev(`closeStats();1`);
  });
  await check('auto-track: Watch Party temporary item is never changed', async () => {
    await app.ev(`items.push({id:'party-800',title:'P',type:'tv',status:'party',_party:true,tmdbId:800,imdbID:'tt800',curSeason:1,curEp:0});playerSrv=0;openPlayer('party-800').then(()=>1)`);
    await app.ev(`window.__pe=0;addEventListener('message',e=>{if(e.data&&e.data.type==='PLAYER_EVENT')__pe++});1`);
    // الأحداث وصلت للصفحة فعلاً (مش التست عدّى عشان البلاير لسه متحمّلش)
    await until(async () => { await fakeEv('playing', 2650); return (await app.ev('__pe')) >= 3; }, 8000, 'party player events');
    const it = await itemOf('party-800');
    assert.deepEqual([it.curEp, it.resume], [0, undefined]);
    await app.ev(`closeModal();1`);
  });
  await check('continue watching: half-watched titles first (episode + time); ▶ opens the player when there is no local file', async () => {
    await app.ev(`items.push(cleanItem({id:'cw1',title:'Half Film',type:'film',status:'queue',tmdbId:901,imdbID:'tt901',resume:{pos:1500,dur:6000,at:Date.now()}}),
      cleanItem({id:'cw2',title:'Half Show',type:'tv',status:'watching',tmdbId:902,imdbID:'tt902',curSeason:2,curEp:3,resume:{s:2,e:4,pos:610,dur:2700,at:Date.now()-1000}}));render();1`);
    const rows = await app.ev(`[...document.querySelectorAll('#cwList .cwrow')].map(r=>r.innerText.replace(/\\s+/g,' '))`);
    const film = rows.findIndex(r => /Half Film.*وقفت عند 25:00/.test(r)), show = rows.findIndex(r => /Half Show.*S02E04 · وقفت عند 10:10/.test(r));
    assert.ok(film === 0 && show > film, 'newest first: ' + JSON.stringify(rows));
    await app.ev(`document.querySelector('#cwList [data-act=cwPlay][data-id=cw2]').click();1`);
    await until(() => app.ev(`playerOpen&&modalId==='cw2'&&!!document.querySelector('.playerbox iframe')`), 4000, 'player opened');
    await app.ev(`closeModal();1`);
  });
  await check('offline: failed check is not recorded, retried next hour', async () => {
    tmdbMode = 'offline';
    await runCheck();
    assert.equal(await app.ev(`chrome.storage.local.get('watchlist:lastSeasonCheck').then(d=>d['watchlist:lastSeasonCheck'])`), '0');
  });
  await check('notify bridge rejects invalid payload in main process', async () => {
    assert.equal(await app.ev(`__wlDesktop.notify({title:''}).then(()=>'accepted',()=>'rejected')`), 'rejected');
  });
  app.close();
} finally { proc.kill(); }

// ---------- تشغيل 4: Watch Party بين نسختين من البرنامج (سيرفر الأوضة الحقيقي محلياً بـ wrangler dev) ----------
{
  const RELAY_PORT = 8798;
  const partyDir = path.join(root, 'party-server');
  const relay = spawn(process.execPath, [path.join(partyDir, 'node_modules/wrangler/bin/wrangler.js'), 'dev', '--port', String(RELAY_PORT), '--ip', '127.0.0.1',
    '--persist-to', fs.mkdtempSync(path.join(os.tmpdir(), 'wl-relay-'))], { cwd: partyDir, stdio: 'ignore' });
  const killTree = p => { if (process.platform === 'win32') { try { execSync(`taskkill /pid ${p.pid} /T /F`, { stdio: 'ignore' }); } catch (e) {} } else p.kill(); };
  // فيديو تست: WAV صامت 15 دقيقة (أطول من حد الإعلانات 60 ثانية، وأطول من مدة التست كلها عشان مايخلصش في النص) جوه iframe من دومين تاني
  const FAKE_VIDEO = `(()=>{const sr=8000,secs=900,n=sr*secs,b=new ArrayBuffer(44+n*2),d=new DataView(b);
    const w=(o,s)=>{for(let i=0;i<s.length;i++)d.setUint8(o+i,s.charCodeAt(i))};
    w(0,'RIFF');d.setUint32(4,36+n*2,true);w(8,'WAVE');w(12,'fmt ');d.setUint32(16,16,true);d.setUint16(20,1,true);d.setUint16(22,1,true);
    d.setUint32(24,sr,true);d.setUint32(28,sr*2,true);d.setUint16(32,2,true);d.setUint16(34,16,true);w(36,'data');d.setUint32(40,n*2,true);
    document.body.innerHTML='';const v=document.createElement('video');v.id='fv';v.muted=true;
    v.src=URL.createObjectURL(new Blob([b],{type:'audio/wav'}));document.body.appendChild(v);
    return new Promise(r=>v.onloadedmetadata=()=>r(v.duration))})()`;
  const IFRAME = `new Promise(r=>{const f=document.createElement('iframe');f.style='position:fixed;bottom:0;left:0;width:400px;height:300px;z-index:99999';f.src='https://example.com';f.onload=r;document.body.appendChild(f)}).then(()=>1)`;
  const vstate = fr => fr.ev(`JSON.stringify({p:fv.paused,t:+fv.currentTime.toFixed(2)})`).then(JSON.parse);
  // ضغطة حقيقية (isTrusted) جوه الفريم — الكنترولر بيبعت بس اللي بعد ضغطة من المستخدم
  const gesture = async fr => { for (const type of ['mousePressed', 'mouseReleased']) await fr('Input.dispatchMouseEvent', { type, x: 5, y: 5, button: 'left', clickCount: 1 }); };

  let pa, pb, edge = null, W = null, webUrl = null;
  try {
    for (let i = 0; i < 60; i++) { await sleep(500); try { if ((await fetch(`http://127.0.0.1:${RELAY_PORT}/room/AAAAAAAA`)).status === 426) break; } catch (e) {} }
    const env = { WL_PARTY_URL: `ws://127.0.0.1:${RELAY_PORT}` };
    pa = await launch(fs.mkdtempSync(path.join(os.tmpdir(), 'wl-test-')), { port: 9341, env });
    pb = await launch(fs.mkdtempSync(path.join(os.tmpdir(), 'wl-test-')), { port: 9342, env });
    console.log('run 4: watch party between two app instances');
    const A = await conn('app://local/', 9341);
    const B = await conn('app://local/', 9342);
    let code;

    await check('host creates room, guest joins with code (any format), both see 2 peers', async () => {
      await A.ev(`partyCreate().then(()=>1)`);
      code = await until(() => A.ev(`party.status==='connected'&&party.code`), 6000, 'host connected');
      await B.ev(`window.__opened=[]; partyOpenMedia=m=>__opened.push(m); 1`); // البلاير الحقيقي مش جزء من التست
      await B.ev(`partyApi.join(${JSON.stringify(code.slice(0, 4).toLowerCase() + '-' + code.slice(4))}).then(()=>1)`);
      await until(() => B.ev(`party.status==='connected'&&party.peers===2`), 6000, 'guest connected');
      await until(() => A.ev(`party.peers===2`), 6000, 'host sees guest');
    });
    await check('guest app rejects a malformed code before touching the network', async () => {
      assert.equal(await B.ev(`partyApi.join('../../x').then(()=>'ok',e=>/bad_code/.test(e.message)?'bad_code':e.message)`), 'bad_code');
      assert.equal(await B.ev(`party.status`), 'connected', 'existing room untouched');
    });
    await check('out-of-list server index from a peer falls back to server 1, never the custom template', async () => {
      assert.equal(await B.ev(`partySrvOf({srv:7})`), 0);
      assert.equal(await B.ev(`partySrvOf({srv:2})`), 2);
      assert.equal(await B.ev(`partySrvOf({srv:3})`), 3, 'vidlink is a built-in server');
      assert.equal(await B.ev(`partySrvOf({srv:-1})`), 0);
    });
    await check('host picks a movie → guest is told to open the same one (ids only)', async () => {
      await A.ev(`partyApi.setMedia({tmdbId:550,type:'movie',srv:0,title:'Fight Club'}).then(()=>1)`);
      const m = await until(() => B.ev(`__opened[0]&&JSON.stringify(__opened[0])`), 6000, 'guest media');
      assert.deepEqual(JSON.parse(m), { tmdbId: 550, type: 'movie', srv: 0, title: 'Fight Club' });
      assert.equal(await A.ev(`partyApi.setMedia({tmdbId:550,type:'movie',srv:0,title:'Fight Club'})`), false, 'same media not re-sent (would reset the room)');
      assert.equal(await A.ev(`partyApi.setMedia({tmdbId:550,type:'movie',srv:'https://evil'}).then(()=>'sent',()=>'rejected')`), 'rejected');
    });

    await A.ev(IFRAME); await B.ev(IFRAME);
    await sleep(500);
    const FA = await conn('example.com', 9341);
    const FB = await conn('example.com', 9342);
    assert.ok(await FA.ev(FAKE_VIDEO) > 60);
    assert.ok(await FB.ev(FAKE_VIDEO) > 60);
    await sleep(2500); // الكنترولر بيمسك الفيديو + فترة تجاهل البداية

    await check('host plays from 30s → guest video plays near 30s', async () => {
      await gesture(FA); await FA.ev(`fv.currentTime=30; fv.play().then(()=>1)`);
      const s = await until(async () => { const v = await vstate(FB); return !v.p && v.t > 29 ? v : null; }, 6000, 'guest playing');
      assert.ok(s.t < 34, JSON.stringify(s));
    });
    await check('host pauses → guest pauses at the same position', async () => {
      await sleep(1000);
      await gesture(FA); await FA.ev(`fv.pause(); 1`);
      const a = await vstate(FA);
      const b = await until(async () => { const v = await vstate(FB); return v.p ? v : null; }, 6000, 'guest paused');
      assert.ok(Math.abs(a.t - b.t) < 1.5, `host ${a.t} guest ${b.t}`);
    });
    await check('guest seeks to 100s → host follows (control works both ways)', async () => {
      await gesture(FB); await FB.ev(`fv.currentTime=100; 1`);
      const a = await until(async () => { const v = await vstate(FA); return Math.abs(v.t - 100) < 1.5 ? v : null; }, 6000, 'host seeked');
      assert.equal(a.p, true);
    });
    await check('no echo loop: both stay paused at 100s for 3s', async () => {
      await sleep(3000);
      const [a, b] = [await vstate(FA), await vstate(FB)];
      assert.ok(a.p && b.p, JSON.stringify({ a, b }));
      assert.ok(Math.abs(a.t - 100) < 1.5 && Math.abs(b.t - 100) < 1.5, JSON.stringify({ a, b }));
    });
    await check('guest plays → host plays (either side can control)', async () => {
      await gesture(FB); await FB.ev(`fv.play().then(()=>1)`);
      await until(async () => !(await vstate(FA)).p, 6000, 'host playing');
    });
    await check('player pausing/seeking by itself (no click) is reverted, not sent to the room', async () => {
      await sleep(2500); // بعد نافذة الضغطة
      await FA.ev(`fv.pause(); fv.currentTime=5; 1`);
      await until(async () => { const v = await vstate(FA); return !v.p && v.t > 100 ? v : null; }, 6000, 'host reverted to room state');
      const b = await vstate(FB);
      assert.ok(!b.p && b.t > 100, 'guest unaffected: ' + JSON.stringify(b));
    });
    // ---- ضيف من المتصفح (صفحة الويب) في نفس الأوضة: Edge headless + بلاير وهمي بنفس شكل أحداث vsembed ----
    await check('web guest: link from the app opens the room page with the same movie and peer count', async () => {
      webUrl = await A.ev(`party.webUrl`);
      assert.ok(webUrl && webUrl.startsWith(`http://127.0.0.1:${RELAY_PORT}/join/`), String(webUrl));
      const edgePath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
      assert.ok(edgePath, 'Edge not found');
      // من غير site isolation الـ iframe بيبقى في نفس الـ process، فـ Fetch بتاع الصفحة بيمسك طلب البلاير
      edge = spawn(edgePath, ['--headless=new', '--remote-debugging-port=9343', `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), 'wl-edge-'))}`,
        '--disable-features=IsolateOrigins,site-per-process', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
      W = await until(async () => { try { return await conn('about:blank', 9343); } catch (e) { return null; } }, 15000, 'edge up');
      W.on('Fetch.requestPaused', ({ requestId }) => W('Fetch.fulfillRequest', {
        requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/html' }],
        body: Buffer.from(`<script>addEventListener('message',e=>{const d=e.data;if(d&&d.fake)parent.postMessage({type:'PLAYER_EVENT',data:{player_status:d.fake,player_progress:d.pos,player_duration:8348}},'*')})</script>`).toString('base64'),
      }));
      await W('Fetch.enable', { patterns: [{ urlPattern: 'https://vsembed.ru/*' }] });
      await W('Page.navigate', { url: webUrl });
      await until(() => W.ev(`document.getElementById('title')?.textContent.includes('Fight Club')`), 8000, 'guest title');
      assert.equal(await W.ev(`document.getElementById('player').src.startsWith('https://vsembed.ru/embed/movie?tmdb=550')`), true);
      await until(() => W.ev(`document.getElementById('peers').textContent.includes('3')`), 6000, 'peers 3');
    });
    const fake = (status, pos) => W.ev(`document.getElementById('player').contentWindow.postMessage({fake:${JSON.stringify(status)},pos:${pos}},'*');1`);
    const hintText = () => W.ev(`(e=>e.hidden?'':e.textContent)(document.getElementById('hint'))`);

    await check('web guest: room playing → hint to press play; once the guest player is in sync the hint goes away', async () => {
      await until(async () => /شغالين/.test(await hintText()), 6000, 'play hint');
      // مكان الأوضة زي ما الصفحة شايفاه (الوقت المكتوب في الشريط) — مش من فيديو البرنامج، عشان فرق التوقيت بين الاتنين ميأثرش
      const t = await W.ev(`document.querySelector('#hint .t').textContent`);
      const roomPos = t.split(':').reduce((a, x) => a * 60 + Number(x), 0);
      // بنعيد الإرسال لحد ما يوصل (البلاير المزيف ممكن يكون لسه بيتحمّل) — بالمكان الحالي عشان ميتحسبش تقديم
      const t0 = Date.now();
      try { await until(async () => { await fake('playing', roomPos + 1 + (Date.now() - t0) / 1000); return (await hintText()) === ''; }, 6000, 'hint cleared'); }
      catch (e) { throw new Error(e.message + ' — hint: ' + (await hintText()) + ' | roomPos(page)=' + roomPos + ' | app A=' + JSON.stringify(await vstate(FA))); }
    });
    await check('web guest pauses (player event) → both app instances pause near that position', async () => {
      const pos = (await vstate(FA)).t + 1;
      await fake('paused', pos);
      const a = await until(async () => { const v = await vstate(FA); return v.p ? v : null; }, 6000, 'app A paused by web guest');
      const b = await until(async () => { const v = await vstate(FB); return v.p ? v : null; }, 6000, 'app B paused by web guest');
      assert.ok(Math.abs(a.t - pos) < 2 && Math.abs(b.t - pos) < 2, JSON.stringify({ pos, a, b }));
    });
    await check('app plays → web guest (still paused) gets a hint, its own status is not sent back', async () => {
      await gesture(FA); await FA.ev(`fv.play().then(()=>1)`);
      await until(async () => /شغالين/.test(await hintText()), 6000, 'guest told to play');
      await sleep(1500);
      assert.equal((await vstate(FA)).p, false, 'guest paused status must not override the room');
    });
    await check('web guest page: hostile title from the room is rendered as text', async () => {
      await A.ev(`partyApi.setMedia({tmdbId:551,type:'movie',srv:0,title:'<img src=x id=pwnweb>'}).then(()=>1)`);
      await until(() => W.ev(`document.getElementById('title').textContent.includes('<img src=x id=pwnweb>')`), 6000, 'new title');
      assert.equal(await W.ev(`!!document.getElementById('pwnweb')`), false);
    });
    W.close(); killTree(edge); edge = null;
    await until(() => B.ev(`party.peers===2`), 8000, 'web guest left');
    await check('host leaves → guest sees 1 peer', async () => {
      await A.ev(`partyLeave().then(()=>1)`);
      await until(() => B.ev(`party.peers===1`), 6000, 'guest peers=1');
      assert.equal(await A.ev(`party.status`), 'idle');
    });
    [A, B, FA, FB].forEach(c => c.close());
  } finally {
    pa && pa.kill(); pb && pb.kill();
    edge && killTree(edge);
    killTree(relay);
  }
}

{
// ---------- تشغيل 5: ترشيحات الـ AI ضد سيرفر وهمي محلي ----------
const hits = [];
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    hits.push({ path: req.url, auth: req.headers.authorization, xkey: req.headers['x-api-key'], body });
    if (req.url.startsWith('/redir')) { res.writeHead(302, { location: `http://${req.headers.host}/steal` }); return res.end(); }
    res.writeHead(200, { 'content-type': 'application/json' });
    if (req.method === 'GET' && req.url.includes('/models')) return res.end(JSON.stringify({ data: [{ id: 'zeta' }, { id: 'alpha' }, { id: 'text-embedding-3-small' }, { id: 'alpha' }, { id: 5 }] }));
    if (req.url.startsWith('/ant')) return res.end(JSON.stringify({ content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '1. Heat (1995) — سبب' }], stop_reason: 'end_turn' }));
    res.end(JSON.stringify({ choices: [{ message: { content: '<think>hmm</think>\n1. Dark (TV, 2017) — مسلسل ألماني\n2. Sicario (2015) — توتر' } }] }));
  });
});
await new Promise(r => mock.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${mock.address().port}`;
const ud5 = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-test-'));
proc = await launch(ud5);
try {
  console.log('run 5: AI recommendations');
  const app = await conn('app://local/');
  const set = cfg => app.ev(`__wlAi.set(${JSON.stringify(cfg)})`);
  const SECRET = 'sk-test-SECRET-123';

  await check('AI endpoint must be https, or http only for local/LAN hosts', async () => {
    assert.equal((await set({ kind: 'openai', url: 'http://evil.example.com/v1', model: 'm', key: SECRET })).error, 'BAD_URL');
    assert.equal((await set({ kind: 'openai', url: 'file:///C:/x', model: 'm' })).error, 'BAD_URL');
    assert.equal((await set({ kind: 'openai', url: base + '/v1', model: 'm', key: 'a\nb' })).error, 'BAD_KEY');
    assert.deepEqual(await set({ kind: 'openai', url: base + '/v1', model: 'm', key: SECRET }), { ok: true, hasKey: true });
  });
  await check('AI key is never returned to the page, not in backups, not plaintext on disk', async () => {
    const g = await app.ev('__wlAi.get()');
    assert.equal(g.hasKey, true); assert.equal('key' in g, false);
    assert.equal(await app.ev(`chrome.storage.local.get(null).then(a=>'watchlist:ai' in a)`), false);
    assert.equal(await app.ev(`chrome.storage.local.get('watchlist:ai').then(a=>'watchlist:ai' in a)`), false);
    assert.ok(!fs.readFileSync(path.join(ud5, 'storage.json'), 'utf8').includes(SECRET));
  });
  await check('restoring a backup cannot redirect the AI endpoint', async () => {
    await app.ev(`chrome.storage.local.set({'watchlist:ai':{kind:'openai',url:'https://evil.example.com/v1',model:'m',key:''}})`);
    assert.equal((await app.ev('__wlAi.get()')).url, base + '/v1');
  });
  await check('model list: fetched with saved key on same server only, cleaned and sorted', async () => {
    const r = await app.ev(`__wlAi.models({kind:'openai',url:${JSON.stringify(base + '/v1/chat/completions')}})`);
    assert.deepEqual(r.models, ['alpha', 'text-embedding-3-small', 'zeta']);
    assert.equal(hits.at(-1).path, '/v1/models'); assert.equal(hits.at(-1).auth, 'Bearer ' + SECRET);
    // localhost ≠ 127.0.0.1 كـ origin: المفتاح المحفوظ ميتبعتش
    const other = base.replace('127.0.0.1', 'localhost');
    assert.equal((await app.ev(`__wlAi.models({kind:'openai',url:${JSON.stringify(other + '/v1')}})`)).ok, true);
    assert.equal(hits.at(-1).auth, undefined);
  });
  await check('UI: model dropdown fills itself, hides non-chat models', async () => {
    const r = await app.ev(`(async()=>{await aiLoad();await aiFetchModels();return [...$('aiModel').options].map(o=>o.value)})()`);
    assert.deepEqual(r, ['', 'alpha', 'zeta']);
    const s = await app.ev(`(()=>{const q=$('aiModelQ');q.value='ZE';q.dispatchEvent(new Event('input'));
      const r={opts:[...$('aiModel').options].map(o=>o.value),sel:$('aiModel').value};q.value='';q.dispatchEvent(new Event('input'));return r})()`);
    assert.deepEqual(s, { opts: ['', 'zeta'], sel: 'zeta' });
  });
  await check('connection test sends a real tiny chat and reports the reply', async () => {
    const r = await app.ev(`__wlAi.test({kind:'openai',url:${JSON.stringify(base + '/v1')},model:'alpha'})`);
    assert.equal(r.ok, true); assert.equal(typeof r.ms, 'number');
    assert.equal(hits.at(-1).auth, 'Bearer ' + SECRET);
    assert.equal(JSON.parse(hits.at(-1).body).model, 'alpha');
    assert.equal((await app.ev(`__wlAi.test({kind:'openai',url:'http://127.0.0.1:1/v1',model:'x'})`)).error, 'UNREACHABLE');
  });
  await check('run sends key to configured endpoint, strips <think>, output parses into titles', async () => {
    const r = await app.ev(`__wlAi.run(tasteProfile())`);
    assert.equal(r.ok, true, JSON.stringify(r));
    const h = hits.at(-1);
    assert.equal(h.path, '/v1/chat/completions'); assert.equal(h.auth, 'Bearer ' + SECRET);
    assert.match(JSON.parse(h.body).messages[0].content, /numbered list/);
    assert.ok(!r.text.includes('think'));
    assert.deepEqual(await app.ev(`parseRecs(${JSON.stringify(r.text)}).map(c=>[c.title,c.year,c.why])`),
      [['Dark', 2017, 'مسلسل ألماني'], ['Sicario', 2015, 'توتر']]);
  });
  await check('redirects are refused (key never follows a redirect)', async () => {
    await set({ kind: 'openai', url: base + '/redir', model: 'm' }); // نفس الـ origin فالمفتاح بيفضل
    const n = hits.length;
    assert.equal((await app.ev(`__wlAi.run('hi')`)).ok, false);
    assert.equal(hits.length, n + 1);
  });
  await check('anthropic format: x-api-key header, text blocks only', async () => {
    await set({ kind: 'anthropic', url: base + '/ant', model: 'claude-opus-5-5', key: SECRET });
    const r = await app.ev(`__wlAi.run('hi')`);
    assert.equal(r.text, '1. Heat (1995) — سبب');
    assert.equal(hits.at(-1).xkey, SECRET); assert.equal(hits.at(-1).auth, undefined);
  });
  await check('UI: "رشّحلي" button fills the pick list with titles and reasons', async () => {
    const r = await app.ev(`(async()=>{await aiLoad();$('tasteBtn').click();
      const shown=getComputedStyle($('aiRunBtn')).display!=='none'&&getComputedStyle($('navAi')).display!=='none'; // الـ AI صفحة في الإعدادات — المهم إن زرارها ظاهر على الديسكتوب
      await aiRun();return {shown,rows:[...document.querySelectorAll('#impList .impRow')].map(x=>x.innerText.replace(/\\s+/g,' ').trim())}})()`);
    assert.equal(r.shown, true);
    assert.equal(r.rows.length, 1); assert.match(r.rows[0], /Heat.*سبب/);
  });
  await check('pick list shows TMDB posters, marks owned titles by TMDB id, rejects hostile poster paths', async () => {
    const r = await app.ev(`(async()=>{
      await chrome.storage.local.set({'watchlist:tmdbkey':'x'});
      items.push({id:'own1',title:'Totally Different Name',type:'film',status:'watched',tmdbId:99});
      tmdbFetch=async p=>({results:p.includes('Dark')
        ?[{media_type:'tv',id:5,name:'Dark',first_air_date:'2017-12-01',poster_path:'/dark.jpg'}]
        :[{media_type:'movie',id:99,title:'Sicario',release_date:'2015-01-01',poster_path:'"><b id=pwn>'}]});
      $('impText').value='1. Dark (2017) — x\\n2. Sicario (2015) — y';
      await importParse();
      const rows=[...document.querySelectorAll('#impList .impRow')];
      return rows.map(row=>({img:row.querySelector('.impP img')?.src||null,on:!row.querySelector('input').disabled}))
        .concat([{pwn:!!document.querySelector('#pwn')}]);
    })()`);
    assert.deepEqual(r, [{ img: 'https://image.tmdb.org/t/p/w92/dark.jpg', on: true }, { img: null, on: false }, { pwn: false }]);
  });
  await check('"شفته ★9" on a recommendation adds it to watched with that rating, and it feeds the next taste profile', async () => {
    const r = await app.ev(`(async()=>{
      const sel=document.querySelector('#impList .impRow .impSeen');
      sel.value='9';sel.dispatchEvent(new Event('change',{bubbles:true}));
      const nr=document.querySelector('.impNoteRow[data-ix="0"]'), noteShown=!nr.hidden;
      nr.querySelector('input').value='  تحفة بس بطيء  ';
      await importAdd();
      const it=items.find(i=>i.title==='Dark');
      return {status:it.status,rating:it.rating,type:it.type,tab,noteShown,note:it.recWhy&&it.note,
        liked:/LIKED[^]*- Dark \\(TV, 2017[^\\n]*my rating 9\\/10 — تحفة بس بطيء/.test(tasteProfile().split('DISLIKED')[0])};
    })()`);
    assert.deepEqual(r, { status: 'watched', rating: 9, type: 'tv', tab: 'watched', noteShown: true, note: 'تحفة بس بطيء', liked: true });
  });
  await check('💡 shows why: reason + the titles from your list it was based on (with your rating)', async () => {
    const r = await app.ev(`(async()=>{
      tmdbFetch=async()=>({results:[]}); // الـ stub بتاع التست اللي فات كان بيرجّع رقم TMDB لعنوان موجود
      const p=parseRecs('1. Heat (1995) — سبب الترشيح [because: Se7en (1995); The Departed]')[0];
      $('impText').value='1. Heat (1995) — سبب الترشيح [because: peaky blinders!; Unknown Show]';
      await importParse();
      document.querySelector('[data-act=impWhy]').click();
      const box=document.querySelector('.impWhyBox');
      return {p:[p.title,p.year,p.why,p.from],open:!box.hidden,text:box.innerText.replace(/\\s+/g,' '),
        stillChecked:document.querySelector('#impList input[data-ix="0"]').checked};
    })()`);
    assert.deepEqual(r.p, ['Heat', 1995, 'سبب الترشيح', ['Se7en (1995)', 'The Departed']]);
    assert.equal(r.open, true); assert.equal(r.stillChecked, true);
    assert.match(r.text, /سبب الترشيح.*Peaky Blinders.*★9.*Unknown Show/);
  });
  await check('switching to another server drops the stored key', async () => {
    assert.equal((await set({ kind: 'openai', url: 'https://api.example.com/v1', model: 'm' })).hasKey, false);
  });
  await check('unreachable server gives a clean error', async () => {
    await set({ kind: 'openai', url: 'http://127.0.0.1:1/v1', model: 'm' });
    assert.equal((await app.ev(`__wlAi.run('hi')`)).error, 'UNREACHABLE');
  });
  app.close();
} finally { proc.kill(); mock.close(); }
}

// ---------- تشغيل 6: أول تشغيل (الشروط + شرح المفاتيح) والإعدادات الجديدة ----------
{
  const ud6 = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-test-'));
  const GOOD_TMDB = '0123456789abcdef0123456789abcdef', GOOD_OMDB = 'good1234';
  proc = await launch(ud6);
  try {
    console.log('run 6: first run (terms + key guide) and settings');
    const app = await conn('app://local/');
    // TMDB/OMDb متزيّفين: مفتاح واحد بس صحيح لكل خدمة
    app.on('Fetch.requestPaused', ({ requestId, request }) => {
      const u = new URL(request.url);
      let status = 200, json = {};
      if (u.host === 'api.themoviedb.org') {
        const ok = u.searchParams.get('api_key') === GOOD_TMDB;
        status = ok ? 200 : 401; json = ok ? { images: {} } : { status_message: 'Invalid API key' };
      } else if (u.host === 'www.omdbapi.com') {
        const ok = u.searchParams.get('apikey') === GOOD_OMDB;
        status = ok ? 200 : 401; json = ok ? { Response: 'True', Title: 'The Shawshank Redemption' } : { Response: 'False', Error: 'Invalid API key!' };
      }
      app('Fetch.fulfillRequest', { requestId, responseCode: status, body: Buffer.from(JSON.stringify(json)).toString('base64'),
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }] });
    });
    await app('Fetch.enable', { patterns: [{ urlPattern: 'https://api.themoviedb.org/*' }, { urlPattern: 'https://www.omdbapi.com/*' }] });
    const stored = k => app.ev(`chrome.storage.local.get(${JSON.stringify(k)}).then(d=>d[${JSON.stringify(k)}]??null)`);
    const step = () => app.ev(`wsteps[wix]`);

    await check('first run: terms first; continue disabled until the box is ticked; acceptance is versioned', async () => {
      const r = JSON.parse(await app.ev(`JSON.stringify({shown:$('welcomeOverlay').classList.contains('show'),steps:wsteps,dis:$('wAgreeBtn').disabled})`));
      assert.deepEqual(r, { shown: true, steps: ['terms', 'choice', 'tmdb', 'omdb', 'done'], dis: true });
      await app.ev(`wAgree().then(()=>1)`);
      assert.equal(await step(), 'terms', 'not accepted without the checkbox');
      await app.ev(`$('wAgree').click();1`);
      assert.equal(await app.ev(`$('wAgreeBtn').disabled`), false);
      await app.ev(`$('wAgreeBtn').click();1`); await sleep(200);
      assert.equal(await stored('watchlist:termsAccepted'), '1');
      assert.equal(await step(), 'choice');
    });
    await check('TMDB step: a wrong key is rejected and NOT saved; a working key is saved and moves on', async () => {
      await app.ev(`$('wFresh')?.click?.();document.querySelector('[data-act="wFresh"]').click();1`); await sleep(100);
      assert.equal(await step(), 'tmdb');
      await app.ev(`$('wTmdb').value='ffffffffffffffffffffffffffffffff';wKeySave('tmdb').then(()=>1)`);
      assert.match(await app.ev(`$('wTmdbStat').textContent`), /مش شغال/);
      assert.equal(await stored('watchlist:tmdbkey'), null);
      await app.ev(`$('wTmdb').value=${JSON.stringify(GOOD_TMDB)};wKeySave('tmdb').then(()=>1)`);
      assert.match(await app.ev(`$('wTmdbStat').textContent`), /شغال واتحفظ/);
      assert.equal(await stored('watchlist:tmdbkey'), GOOD_TMDB);
      await until(async () => (await step()) === 'omdb', 3000, 'auto next to OMDb');
    });
    await check('OMDb is optional: skip → done → onboarded; reopening shows nothing', async () => {
      await app.ev(`$('wOmdbSkip').click();1`);
      assert.equal(await step(), 'done');
      await app.ev(`document.querySelector('[data-act="wDone"]').click();1`); await sleep(200);
      assert.equal(await stored('watchlist:onboarded'), '1');
      assert.equal(await app.ev(`$('welcomeOverlay').classList.contains('show')`), false);
      await app.ev(`startOnboarding().then(()=>1)`);
      assert.equal(await app.ev(`$('welcomeOverlay').classList.contains('show')`), false);
    });
    await check('existing user + new terms version → only the terms screen (no key steps)', async () => {
      await app.ev(`chrome.storage.local.set({'watchlist:termsAccepted':'0'}).then(()=>startOnboarding()).then(()=>1)`);
      assert.deepEqual(JSON.parse(await app.ev(`JSON.stringify(wsteps)`)), ['terms']);
      await app.ev(`$('wAgree').click();$('wAgreeBtn').click();1`); await sleep(200);
      assert.equal(await app.ev(`$('welcomeOverlay').classList.contains('show')`), false);
    });
    await check('settings: one page at a time; keys page shows live status (TMDB ok, OMDb shared)', async () => {
      await app.ev(`openSettings('pgKeys');1`);
      await until(() => app.ev(`$('tmdbBadge').textContent.includes('شغال')`), 4000, 'tmdb badge');
      const r = JSON.parse(await app.ev(`JSON.stringify({visible:[...document.querySelectorAll('#setBody .spage')].filter(p=>!p.hidden).map(p=>p.id),omdb:$('omdbBadge').textContent,sharedBtn:$('keySharedBtn').hidden})`));
      assert.deepEqual(r, { visible: ['pgKeys'], omdb: 'المفتاح المشترك', sharedBtn: true });
    });
    await check('settings: wrong OMDb key not saved; good key saved; back to shared clears it', async () => {
      await app.ev(`$('apiKey').value='bad99999';keySave('omdb').then(()=>1)`);
      assert.equal(await stored('watchlist:omdbkey'), null);
      await app.ev(`$('apiKey').value=${JSON.stringify(GOOD_OMDB)};keySave('omdb').then(()=>1)`);
      assert.equal(await stored('watchlist:omdbkey'), GOOD_OMDB);
      assert.equal(await app.ev(`$('keySharedBtn').hidden`), false);
      await app.ev(`keyShared().then(()=>1)`);
      assert.equal(await stored('watchlist:omdbkey'), '');
      assert.equal(await app.ev(`$('omdbBadge').textContent`), 'المفتاح المشترك');
    });
    await check('settings: advanced templates validated on change (javascript: rejected), default server saved', async () => {
      await app.ev(`setNav('pgWatch');$('playerTpl').value='javascript:alert(1)';$('playerTpl').dispatchEvent(new Event('change'));1`);
      await sleep(200);
      assert.match(await app.ev(`$('playerTplErr').textContent`), /https/);
      assert.equal(await stored('watchlist:playerTpl'), null);
      await app.ev(`$('playerTpl').value='https://example.org/e/{type}/{tmdbID}';$('playerTpl').dispatchEvent(new Event('change'));1`);
      await sleep(300);
      assert.equal(await stored('watchlist:playerTpl'), 'https://example.org/e/{type}/{tmdbID}');
      assert.match(await app.ev(`$('defSrv').textContent`), /مخصص/, 'custom template shows as a server option');
      await app.ev(`document.querySelector('#defSrv [data-ix="3"]').click();1`); await sleep(300);
      assert.equal(await stored('watchlist:playerSrv'), '3');
      assert.equal(await app.ev(`playerSrv`), 3);
    });
    await check('terms can be re-read from "about" (read-only, closable); key-guide links are allowlisted exactly', async () => {
      await app.ev(`setNav('pgAbout');document.querySelector('[data-act="showTerms"]').click();1`);
      const r = JSON.parse(await app.ev(`JSON.stringify({step:wsteps[wix],guide:$('welcomeOverlay').classList.contains('guide'),agreeHidden:getComputedStyle(document.querySelector('.wagree')).display==='none',close:!$('wClose').hidden})`));
      assert.deepEqual(r, { step: 'terms', guide: true, agreeHidden: true, close: true });
      await app.ev(`$('wClose').click();1`);
      for (const u of ['https://www.themoviedb.org/signup?next=evil', 'https://www.themoviedb.org/login', 'https://www.omdbapi.com/', 'https://themoviedb.org/signup']) {
        assert.equal(await app.ev(`__wlDesktop.openExternal(${JSON.stringify(u)})`), false, u);
      }
    });
    app.close();
  } finally { proc.kill(); await sleep(1000); }
}

// ---------- تشغيل 7: التنزيلات بتكمّل بعد قفل البرنامج + المكتبة بفولدرات فرعية ----------
{
  const ud7 = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-test-')), dl7 = path.join(ud7, 'dl');
  fs.writeFileSync(path.join(ud7, 'storage.json'), JSON.stringify({ 'watchlist:seeded': '1' }));
  // سيرفر بيدعم Range (زي أغلب مواقع التحميل)، محتوى معروف عشان نتأكد إن الملف اتكمّل صح مش اتلخبط
  const SIZE = 96 * 65536, body = Buffer.from(Uint8Array.from({ length: SIZE }, (_, k) => k % 251));
  const ranges = [];
  const srv = http.createServer((req, res) => {
    const m = /bytes=(\d+)-/.exec(req.headers.range || ''), from = m ? +m[1] : 0;
    if (m) ranges.push(from);
    res.writeHead(m ? 206 : 200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${req.url.slice(1)}"`,
      'Accept-Ranges': 'bytes', ETag: '"v1"', 'Last-Modified': 'Mon, 01 Jan 2024 00:00:00 GMT', 'Content-Length': SIZE - from,
      ...(m ? { 'Content-Range': `bytes ${from}-${SIZE - 1}/${SIZE}` } : {}) });
    let p = from;
    const t = setInterval(() => { const n = Math.min(65536, SIZE - p); res.write(body.subarray(p, p + n)); p += n; if (p >= SIZE) { clearInterval(t); res.end(); } }, 60);
    res.on('close', () => clearInterval(t));
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const opts = { env: { WL_DL_DIR: dl7 }, args: ['--inspect=9231'] };
  const item = async (app, name) => (await app.ev(`__wlDesktop.dl.state()`)).items.find(i => i.name === name);
  const startDl = async (app, name) => {
    await app.ev(`(()=>{const w=window.open('about:blank','_blank');w.location=${JSON.stringify(base + '/')}+${JSON.stringify(name)};return 1})()`);
    await until(() => app.ev(`$('confirmOverlay').classList.contains('show')`), 8000, 'confirm ' + name);
    await app.ev(`$('confirmYes').click();1`);
    await until(async () => (await item(app, name))?.received > 1000000, 15000, name + ' started');
  };
  const sameBytes = name => { const f = fs.readFileSync(path.join(dl7, name)); return f.length === SIZE && f.equals(body); };
  let p7 = await launch(ud7, opts);
  try {
    console.log('run 7: downloads survive closing the app; library subfolders');
    let app = await conn('app://local/');
    await check('download in progress → app quits normally → next start continues from where it stopped (Range); file intact', async () => {
      await startDl(app, 'a.mp4');
      // خروج عادي (زي "اقفل" من الـ tray) — Electron بيمسح الملف الناقص لوحده، والـ hard link بيحافظ عليه
      const node = await conn('', 9231); // inspector بتاع main (التست بس — --inspect)
      await node('Runtime.evaluate', { expression: `process.mainModule.require('electron').app.quit()` });
      node.close(); // Node بـ --inspect بيستنى الـ debugger يفصل قبل ما يقفل
      await until(() => p7.exitCode !== null, 10000, 'app quit');
      assert.ok(fs.existsSync(path.join(dl7, 'a.mp4')) || fs.existsSync(path.join(dl7, 'a.mp4.wlpart')), 'partial data kept');
      p7 = await launch(ud7, opts); app = await conn('app://local/');
      await until(async () => (await item(app, 'a.mp4'))?.state === 'completed', 30000, 'a.mp4 continued and finished');
      assert.ok(ranges.some(r => r > 1000000), 'continued with a Range request: ' + ranges.join(','));
      assert.ok(sameBytes('a.mp4'), 'file content intact');
      assert.equal(fs.existsSync(path.join(dl7, 'a.mp4.wlpart')), false);
    });
    await check('app killed mid-download (crash) → continues on next start', async () => {
      ranges.length = 0;
      await startDl(app, 'b.mp4');
      await sleep(700); // آخر حالة اتحفظت (كل 300ms)
      p7.kill(); await sleep(1500);
      p7 = await launch(ud7, opts); app = await conn('app://local/');
      await until(async () => (await item(app, 'b.mp4'))?.state === 'completed', 30000, 'b.mp4 continued and finished');
      assert.ok(ranges.some(r => r > 1000000), 'continued with a Range request: ' + ranges.join(','));
      assert.ok(sameBytes('b.mp4'), 'file content intact');
    });
    await check('library: subfolders (up to 3 levels), episode from folder/file names, paths cannot escape the folder', async () => {
      fs.mkdirSync(path.join(dl7, 'Lib Show', 'Season 2'), { recursive: true });
      fs.writeFileSync(path.join(dl7, 'Lib Show', 'Season 2', 'Lib Show - Episode 05.mp4'), 'x');
      fs.mkdirSync(path.join(dl7, 'a', 'b', 'c', 'd'), { recursive: true });
      fs.writeFileSync(path.join(dl7, 'a', 'b', 'c', 'd', 'deep.mp4'), 'x');
      await app.ev(`items.push(cleanItem({id:'ls',title:'Lib Show',type:'tv',status:'watching',tmdbId:77}));dlRefresh().then(()=>1)`);
      const r = JSON.parse(await app.ev(`JSON.stringify(dl.library.map(f=>{const l=libInfo(f);return {n:f.name,id:l&&l.it.id,s:l&&l.s,e:l&&l.e}}))`));
      const ep = r.find(x => x.n === 'Lib Show/Season 2/Lib Show - Episode 05.mp4');
      assert.deepEqual(ep, { n: 'Lib Show/Season 2/Lib Show - Episode 05.mp4', id: 'ls', s: 2, e: 5 }, JSON.stringify(r));
      assert.ok(!r.some(x => x.n.endsWith('deep.mp4')), 'deeper than 3 levels is skipped');
      for (const bad of ['../storage.json', '..\\storage.json', 'Lib Show/../../storage.json', 'C:/Windows/win.ini', 'a.mp4/../a.mp4'])
        assert.equal(await app.ev(`__wlDesktop.dl.reveal(${JSON.stringify(bad)})`), false, bad);
    });
    app.close();
  } finally { p7.kill(); srv.close(); await sleep(1000); }
}

console.log(`\n${passed} checks passed`);
process.exit(0);
