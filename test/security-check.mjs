// فحص أمان end-to-end: بيشغّل البرنامج ببيانات متلغّمة في فولدر مؤقت ويتأكد إن الحمايات شغالة
// محتاج نت (بيحمّل example.com كـ iframe خارجي). التشغيل: npm test
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const electron = createRequire(import.meta.url)('electron');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..');
const PORT = 9333;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function launch(userData) {
  const proc = spawn(electron, [root, `--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`], { stdio: 'ignore' });
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      if (list.some(t => t.url.startsWith('app://local/'))) { await sleep(1500); return proc; }
    } catch (e) {}
  }
  proc.kill();
  throw new Error('app did not start');
}

const targets = async () => (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json());
async function conn(match) {
  const t = (await targets()).find(x => x.url.includes(match));
  assert.ok(t, `target ${match} not found`);
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(r => { ws.onopen = r; });
  let id = 0; const pend = {};
  ws.onmessage = m => { const d = JSON.parse(m.data); pend[d.id]?.(d.result); };
  const call = (method, params = {}) => new Promise(r => { pend[++id] = r; ws.send(JSON.stringify({ id, method, params })); });
  call.ev = async expr => {
    const r = await call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  call.close = () => ws.close();
  return call;
}
const pages = async () => (await targets()).filter(t => t.type === 'page').map(t => t.url);

let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log('  ✔', name); }

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
    { id: 'ok1', title: 'Good', type: 'tv', status: 'watched', rating: 8 },
    { title: '' },
  ]),
  'watchlist:sites': JSON.stringify([{ name: 'bad', url: 'javascript:alert(1)' }, { name: 'good', url: 'https://example.org/{q}' }]),
  'watchlist:playerTpl': 'javascript:parent.document.title="pwned"',
}));
proc = await launch(ud2);
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
  await check('javascript: sites dropped, javascript: player template rejected', async () => {
    assert.deepEqual(await app.ev('sites.map(s=>s.name)'), ['good']);
    assert.equal(await app.ev(`playerSrv=99; playerSrc({...items[1], tmdbId:1})`), null);
    assert.equal(await app.ev(`(()=>{try{fillUrl('javascript:x',items[1],1);return 'allowed'}catch(e){return e.message}})()`), 'BAD_URL');
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
    assert.equal(await fr.ev('hits'), 1, 'click did not reach the link — test invalid');
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
    await app.ev(`window.open('about:blank','_blank').location='https://example.org'; 1`);
    await sleep(2500);
    assert.ok((await pages()).some(u => u.startsWith('https://example.org')));
    const child = await conn('example.org');
    assert.equal(await child.ev('typeof (window.chrome && chrome.storage)'), 'undefined');
    child.close();
  });
  app.close();
} finally { proc.kill(); }

console.log(`\n${passed} checks passed`);
process.exit(0);
