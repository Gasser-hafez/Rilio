// فحص end-to-end: بيشغّل البرنامج في فولدر بيانات مؤقت ويتأكد من الحمايات ومن إشعارات المواسم
// محتاج نت (بيحمّل example.com كـ iframe خارجي). التشغيل: npm test
import { spawn, execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const electron = createRequire(import.meta.url)('electron');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..');
const PORT = 9333;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function launch(userData, { port = PORT, env = {} } = {}) {
  // لو نافذة التست متغطية بنافذة تانية، ويندوز بيعلّمها hidden وChromium بيوقف توصيل الضغطات —
  // الـ flags دي بتخلي التست مايعتمدش على ترتيب النوافذ على الشاشة
  const flags = ['--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'];
  const proc = spawn(electron, [root, `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`, ...flags], { stdio: 'ignore', env: { ...process.env, ...env } });
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
    await app.ev(`window.open('about:blank','_blank').location='https://example.org'; 1`);
    await sleep(2500);
    assert.ok((await pages()).some(u => u.startsWith('https://example.org')));
    const child = await conn('example.org');
    assert.equal(await child.ev('typeof (window.chrome && chrome.storage)'), 'undefined');
    child.close();
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
    if (tmdbMode === 'offline') return app('Fetch.failRequest', { requestId, errorReason: 'InternetDisconnected' });
    const id = (request.url.match(/\/tv\/(\d+)/) || [])[1];
    tmdbHits.push(id);
    const body = Buffer.from(JSON.stringify(TMDB[id] || {})).toString('base64');
    app('Fetch.fulfillRequest', {
      requestId, responseCode: TMDB[id] ? 200 : 404, body,
      responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }],
    });
  });
  await app('Fetch.enable', { patterns: [{ urlPattern: 'https://api.themoviedb.org/*' }] });
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
  // فيديو تست: WAV صامت 3 دقايق (أطول من حد الإعلانات 60 ثانية) جوه iframe من دومين تاني
  const FAKE_VIDEO = `(()=>{const sr=8000,secs=180,n=sr*secs,b=new ArrayBuffer(44+n*2),d=new DataView(b);
    const w=(o,s)=>{for(let i=0;i<s.length;i++)d.setUint8(o+i,s.charCodeAt(i))};
    w(0,'RIFF');d.setUint32(4,36+n*2,true);w(8,'WAVE');w(12,'fmt ');d.setUint32(16,16,true);d.setUint16(20,1,true);d.setUint16(22,1,true);
    d.setUint32(24,sr,true);d.setUint32(28,sr*2,true);d.setUint16(32,2,true);d.setUint16(34,16,true);w(36,'data');d.setUint32(40,n*2,true);
    document.body.innerHTML='';const v=document.createElement('video');v.id='fv';v.muted=true;
    v.src=URL.createObjectURL(new Blob([b],{type:'audio/wav'}));document.body.appendChild(v);
    return new Promise(r=>v.onloadedmetadata=()=>r(v.duration))})()`;
  const IFRAME = `new Promise(r=>{const f=document.createElement('iframe');f.style='position:fixed;bottom:0;left:0;width:400px;height:300px;z-index:99999';f.src='https://example.com';f.onload=r;document.body.appendChild(f)}).then(()=>1)`;
  const until = async (fn, ms = 6000, what = 'condition') => {
    const end = Date.now() + ms;
    for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timeout: ' + what); await sleep(200); }
  };
  const vstate = fr => fr.ev(`JSON.stringify({p:fv.paused,t:+fv.currentTime.toFixed(2)})`).then(JSON.parse);
  // ضغطة حقيقية (isTrusted) جوه الفريم — الكنترولر بيبعت بس اللي بعد ضغطة من المستخدم
  const gesture = async fr => { for (const type of ['mousePressed', 'mouseReleased']) await fr('Input.dispatchMouseEvent', { type, x: 5, y: 5, button: 'left', clickCount: 1 }); };

  let pa, pb;
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
    await check('host leaves → guest sees 1 peer', async () => {
      await A.ev(`partyLeave().then(()=>1)`);
      await until(() => B.ev(`party.peers===1`), 6000, 'guest peers=1');
      assert.equal(await A.ev(`party.status`), 'idle');
    });
    [A, B, FA, FB].forEach(c => c.close());
  } finally {
    pa && pa.kill(); pb && pb.kill();
    killTree(relay);
  }
}

console.log(`\n${passed} checks passed`);
process.exit(0);
