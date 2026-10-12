// فحص أمان end-to-end: بيشغّل البرنامج ببيانات متلغّمة في فولدر مؤقت ويتأكد إن الحمايات شغالة
// محتاج نت (بيحمّل example.com كـ iframe خارجي). التشغيل: npm test
import { spawn } from 'node:child_process';
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

async function launch(userData) {
  // من غير الفلاجات دي لو الشاشة عليها نوافذ تانية ويندوز بيعتبر نافذة التست مستخبية والكليكات الوهمية متوصلش للـ iframe
  const proc = spawn(electron, [root, `--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`,
    '--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'], { stdio: 'ignore' });
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
} finally { proc.kill(); await sleep(1000); }

// ---------- تشغيل 3: ترشيحات الـ AI ضد سيرفر وهمي محلي ----------
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
const ud3 = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-test-'));
proc = await launch(ud3);
try {
  console.log('run 3: AI recommendations');
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
    assert.ok(!fs.readFileSync(path.join(ud3, 'storage.json'), 'utf8').includes(SECRET));
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
      const shown=getComputedStyle($('aiRunBtn')).display!=='none'&&getComputedStyle($('aiSec')).display!=='none';
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

console.log(`\n${passed} checks passed`);
process.exit(0);
