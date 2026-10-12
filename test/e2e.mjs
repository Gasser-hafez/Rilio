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
    { id: 'ok1', title: 'Good', type: 'tv', status: 'watched', rating: 8, recWhy: '<img src=x id=pwn4>', recFrom: [{}, '<b id=pwn5>', 7] },
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
  await app('Fetch.enable', { patterns: [{ urlPattern: 'https://api.themoviedb.org/*' }, { urlPattern: 'https://www.omdbapi.com/*' }] });
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
  const until = async (fn, ms = 6000, what = 'condition') => {
    const end = Date.now() + ms;
    for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timeout: ' + what); await sleep(200); }
  };
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
      await fake('playing', roomPos + 1);
      try { await until(async () => (await hintText()) === '', 6000, 'hint cleared'); }
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
  const until = async (fn, ms = 6000, what = 'condition') => {
    const end = Date.now() + ms;
    for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timeout: ' + what); await sleep(200); }
  };
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

console.log(`\n${passed} checks passed`);
process.exit(0);
