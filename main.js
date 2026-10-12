// نسخة الديسكتوب — نفس app.html/app.js بتاعة الاكستنشن، والـ chrome.storage بيتعمله shim في preload.js
const { app, BrowserWindow, ipcMain, Tray, Menu, Notification, protocol, net, session, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { initUpdater } = require('./updater');
const { initParty } = require('./party');

if (!app.requestSingleInstanceLock()) app.quit();
// لازم يطابق appId في package.json عشان إشعارات ويندوز تظهر
// لازم يطابق appId في package.json (بيفضل com.watchlist.desktop حتى بعد الاسم الجديد —
// لو اتغيّر، ويندوز بيعتبر التحديث برنامج تاني ويتثبّت جنب القديم)
app.setAppUserModelId('com.watchlist.desktop');

// الواجهة بتتحمل من app://local بدل file:// — صفحة file:// تقدر تقرا أي ملف على الجهاز لو حصل فيها injection
const APP_ORIGIN = 'app://local/';
const APP_FILES = new Set(['app.html', 'app.js', 'icon16.png', 'icon48.png', 'icon128.png']);
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true } }]);

/* ================= التخزين ================= */
const DB = path.join(app.getPath('userData'), 'storage.json');
// الاسم اتغيّر من Watchlist لـ rilio فالفولدر اتغيّر — أول تشغيل بننسخ بيانات الفولدر القديم (ومبنمسحوش، يفضل نسخة احتياطية).
// مش لما الفولدر متحدد بـ --user-data-dir (التستات والتجارب) عشان ميتنسخش بيانات حد حقيقية فيه
const OLD_DB = path.join(app.getPath('appData'), 'Watchlist', 'storage.json');
if (!app.commandLine.hasSwitch('user-data-dir') && !fs.existsSync(DB) && fs.existsSync(OLD_DB)) {
  try {
    fs.mkdirSync(path.dirname(DB), { recursive: true });
    fs.copyFileSync(OLD_DB, DB, fs.constants.COPYFILE_EXCL);
    // مفتاح تشفير safeStorage (اللي متشفّر بيه مفتاح الـ AI) محفوظ في Local State — من غيره المفتاح مش هيتفك
    const oldState = path.join(path.dirname(OLD_DB), 'Local State'), newState = path.join(path.dirname(DB), 'Local State');
    if (fs.existsSync(oldState) && !fs.existsSync(newState)) fs.copyFileSync(oldState, newState);
  } catch (e) { console.error('could not migrate Watchlist data:', e.message); }
}
let store = {};
try {
  store = JSON.parse(fs.readFileSync(DB, 'utf8'));
} catch (e) {
  // ملف بايظ: نحتفظ بيه جنب الأصلي بدل ما أول كتابة تمسح بيانات المستخدم
  if (e.code !== 'ENOENT') {
    try { fs.renameSync(DB, DB.replace(/\.json$/, `.corrupt-${Date.now()}.json`)); } catch (e2) {}
    console.error('storage.json unreadable, moved aside:', e.message);
  }
}

function saveStore(next) {
  // كتابة لملف مؤقت وبعدين rename عشان الملف ميتبوظش لو البرنامج اتقفل في النص
  fs.writeFileSync(DB + '.tmp', JSON.stringify(next));
  fs.renameSync(DB + '.tmp', DB);
}

// الواجهة الرئيسية بس هي اللي ليها تكلّم التخزين — مش أي فريم أو موقع خارجي
const fromApp = e => !!e.senderFrame && e.senderFrame.parent === null && e.senderFrame.url.startsWith(APP_ORIGIN);

// إعدادات الـ AI (فيها المفتاح متشفّر) مقفولة على الواجهة: مبتطلعش في النسخة الاحتياطية،
// ونسخة احتياطية/إعدادات من حد تاني متقدرش تغيّر الـ endpoint وتسحب المفتاح لسيرفرها
const AI_KEY = 'watchlist:ai';

ipcMain.handle('wl:get', (e, keys) => {
  if (!fromApp(e)) throw new Error('forbidden');
  if (keys == null) { const { [AI_KEY]: _, ...rest } = store; return rest; }
  const out = {};
  for (const k of [].concat(keys)) if (typeof k === 'string' && k !== AI_KEY && Object.hasOwn(store, k)) out[k] = store[k];
  return out;
});

ipcMain.handle('wl:set', (e, obj) => {
  if (!fromApp(e)) throw new Error('forbidden');
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('bad payload');
  const changes = {};
  const next = { ...store };
  for (const [k, v] of Object.entries(obj)) {
    if (k === AI_KEY) continue;
    // زي كروم: مفيش event لو القيمة متغيرتش (app.js بيعد كتاباته بـ selfWrites)
    if (JSON.stringify(store[k]) === JSON.stringify(v)) continue;
    changes[k] = { oldValue: store[k], newValue: v };
    next[k] = v;
  }
  if (!Object.keys(changes).length) return;
  saveStore(next); // لو الحفظ فشل الـ store في الميموري ميتغيرش والواجهة بتعرض "فشل الحفظ"
  store = next;
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('wl:changed', changes);
  if (changes['watchlist:data']) updateBadge();
});

/* ================= ترشيحات الـ AI ================= */
// الطلب بيتعمل هنا مش في الواجهة: الـ CSP بتاعة الواجهة مقفولة على TMDB/OMDb، والسيرفرات المحلية
// (Ollama/LM Studio) فيها مشاكل CORS، والواجهة ممنوعة من الشبكة المحلية
const AI_KINDS = ['openai', 'anthropic'];
const AI_MAX_BYTES = 8 * 1024 * 1024; // قايمة موديلات OpenRouter لوحدها بتعدّي 1MB
// http مسموح بس للجهاز نفسه أو الشبكة المحلية — غير كده المفتاح هيتبعت مكشوف
const LOCAL_HOST = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|[\w-]+\.local)$/i;
function aiUrlOk(u) {
  try {
    const x = new URL(u);
    if (x.username || x.password) return false;
    return x.protocol === 'https:' || (x.protocol === 'http:' && LOCAL_HOST.test(x.hostname));
  } catch (e) { return false; }
}
const originOf = u => { try { return new URL(u).origin; } catch (e) { return null; } };
const aiCfg = () => (store[AI_KEY] && typeof store[AI_KEY] === 'object' ? store[AI_KEY] : {});
function aiSecret(c) {
  if (typeof c.key !== 'string' || !c.key) return '';
  try { return safeStorage.decryptString(Buffer.from(c.key, 'base64')); } catch (e) { return ''; }
}
function writeAi(cfg) {
  const next = { ...store };
  if (cfg) next[AI_KEY] = cfg; else delete next[AI_KEY];
  saveStore(next);
  store = next;
}

// الواجهة بتعرف إذا كان فيه مفتاح بس — المفتاح نفسه مبيرجعلهاش أبداً
ipcMain.handle('wl:aiGet', e => {
  if (!fromApp(e)) throw new Error('forbidden');
  const c = aiCfg();
  return { kind: AI_KINDS.includes(c.kind) ? c.kind : 'openai', url: typeof c.url === 'string' ? c.url : '', model: typeof c.model === 'string' ? c.model : '', hasKey: !!c.key };
});

// تنضيف وفحص اللي جاي من الواجهة (حفظ أو جلب موديلات). الرابط بيتخزن base من غير /chat/completions أو /messages
function aiInput(cfg) {
  const s = v => (typeof v === 'string' ? v.trim() : '');
  const kind = s(cfg && cfg.kind), model = s(cfg && cfg.model), key = s(cfg && cfg.key);
  const url = s(cfg && cfg.url).replace(/\/+$/, '').replace(/\/(chat\/completions|messages)$/, '');
  if (!AI_KINDS.includes(kind)) return { ok: false, error: 'BAD_KIND' };
  if (url.length > 500 || !aiUrlOk(url)) return { ok: false, error: 'BAD_URL' };
  if (model.length > 200) return { ok: false, error: 'BAD_MODEL' };
  if (key.length > 1000 || !/^[\x21-\x7e]*$/.test(key)) return { ok: false, error: 'BAD_KEY' };
  return { ok: true, kind, url, model, key };
}
// المفتاح المحفوظ بيتستخدم بس مع نفس السيرفر اللي اتحفظ عليه — عمره ما يتبعت لـ origin تاني
const storedKeyFor = url => { const old = aiCfg(); return typeof old.key === 'string' && originOf(old.url) === originOf(url) ? old.key : ''; };

ipcMain.handle('wl:aiSet', (e, cfg) => {
  if (!fromApp(e)) throw new Error('forbidden');
  if (!(cfg && typeof cfg.url === 'string' && cfg.url.trim())) { writeAi(null); return { ok: true, hasKey: false }; } // رابط فاضي = اقفل الـ AI وامسح المفتاح
  const v = aiInput(cfg);
  if (!v.ok) return v;
  if (!v.model) return { ok: false, error: 'BAD_MODEL' };
  let enc = storedKeyFor(v.url);
  if (v.key) {
    if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: 'NO_CRYPTO' };
    enc = safeStorage.encryptString(v.key).toString('base64');
  }
  writeAi({ kind: v.kind, url: v.url, model: v.model, key: enc });
  return { ok: true, hasKey: !!enc };
});

async function readCapped(res) {
  const chunks = [];
  let n = 0;
  for await (const ch of res.body || []) {
    n += ch.length;
    if (n > AI_MAX_BYTES) throw new Error('TOO_BIG');
    chunks.push(ch);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// طلب واحد للسيرفر (GET لو مفيش body). بيرجع { ok, j } أو { ok:false, error, status, detail } — عمره ما بيرمي
async function aiCall(kind, url, key, endpoint, body) {
  const headers = { 'content-type': 'application/json' };
  if (kind === 'anthropic') { headers['anthropic-version'] = '2023-06-01'; if (key) headers['x-api-key'] = key; }
  else if (key) headers.authorization = 'Bearer ' + key;
  try {
    let res;
    try {
      // redirect: 'error' — مفيش API محترم بيعمل redirect، ولو حصل المفتاح ميروحش لدومين تاني
      res = await fetch(url + endpoint, { method: body ? 'POST' : 'GET', headers, body: body && JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(body ? 180000 : 20000) });
    } catch (err) {
      return { ok: false, error: err.name === 'TimeoutError' ? 'TIMEOUT' : 'UNREACHABLE' };
    }
    const raw = await readCapped(res);
    let j = null;
    try { j = JSON.parse(raw); } catch (err) {}
    if (!res.ok) {
      let detail = String((j && ((j.error && j.error.message) || (typeof j.error === 'string' && j.error))) || '').slice(0, 300);
      if (key) detail = detail.split(key).join('***');
      return { ok: false, error: res.status === 401 || res.status === 403 ? 'BAD_KEY' : 'HTTP', status: res.status, detail };
    }
    return { ok: true, j };
  } catch (err) {
    return { ok: false, error: err.name === 'TimeoutError' ? 'TIMEOUT' : 'BAD_RESPONSE' };
  }
}

// قايمة الموديلات — الاتنين (OpenAI-compatible وAnthropic) بيرجعوا { data: [{ id }] }
ipcMain.handle('wl:aiModels', async (e, cfg) => {
  if (!fromApp(e)) throw new Error('forbidden');
  const v = aiInput(cfg);
  if (!v.ok) return v;
  const key = v.key || aiSecret({ key: storedKeyFor(v.url) });
  const r = await aiCall(v.kind, v.url, key, v.kind === 'anthropic' ? '/models?limit=1000' : '/models');
  if (!r.ok) return r;
  const data = r.j && Array.isArray(r.j.data) ? r.j.data : null;
  if (!data) return { ok: false, error: 'BAD_RESPONSE' };
  const ids = [...new Set(data.map(m => m && m.id).filter(id => typeof id === 'string' && id && id.length <= 200))];
  return { ok: true, models: ids.sort().slice(0, 3000) };
});

// رسالة واحدة للموديل وإرجاع النص — مستخدمة في الترشيح وفي اختبار الاتصال
async function aiChat(kind, url, key, model, prompt) {
  const anth = kind === 'anthropic';
  const messages = [{ role: 'user', content: prompt }];
  const r = await aiCall(kind, url, key, anth ? '/messages' : '/chat/completions',
    anth ? { model, max_tokens: 16000, messages } : { model, messages });
  if (!r.ok) return r;
  const j = r.j;
  if (anth && j && j.stop_reason === 'refusal') return { ok: false, error: 'REFUSED' };
  const text = anth
    ? (j && Array.isArray(j.content) ? j.content.filter(b => b && b.type === 'text' && typeof b.text === 'string').map(b => b.text).join('\n') : '')
    : j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
  if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'EMPTY' };
  // موديلات التفكير المحلية (deepseek-r1 وغيره) بترجع تفكيرها جوه <think>
  return { ok: true, text: text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim() };
}

// طلب واحد في نفس الوقت (ترشيح أو اختبار) — الضغط المتكرر ميصرفش من رصيد المفتاح
let aiBusy = false;
async function aiOnce(fn) {
  if (aiBusy) return { ok: false, error: 'BUSY' };
  aiBusy = true;
  try { return await fn(); } finally { aiBusy = false; }
}

ipcMain.handle('wl:aiRun', (e, prompt) => {
  if (!fromApp(e)) throw new Error('forbidden');
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 200000) return { ok: false, error: 'BAD_PROMPT' };
  const c = aiCfg();
  if (!aiUrlOk(c.url) || !AI_KINDS.includes(c.kind) || typeof c.model !== 'string' || !c.model) return { ok: false, error: 'NOT_CONFIGURED' };
  return aiOnce(() => aiChat(c.kind, c.url, aiSecret(c), c.model, prompt));
});

// اختبار الاتصال بالقيم اللي في الفورم (قبل الحفظ) — رسالة صغيرة حقيقية للموديل
ipcMain.handle('wl:aiTest', (e, cfg) => {
  if (!fromApp(e)) throw new Error('forbidden');
  const v = aiInput(cfg);
  if (!v.ok) return v;
  if (!v.model) return { ok: false, error: 'BAD_MODEL' };
  const key = v.key || aiSecret({ key: storedKeyFor(v.url) });
  return aiOnce(async () => {
    const t = Date.now();
    const r = await aiChat(v.kind, v.url, key, v.model, 'Reply with just the word: OK');
    return r.ok ? { ok: true, ms: Date.now() - t, reply: r.text.slice(0, 80) } : r;
  });
});

// السكريبتات اللي بتتحقن في فريمات البلاير (preload مقفول في sandbox فمبيقدرش يقرا ملفات)
const frameScripts = {
  popupblock: fs.readFileSync(path.join(__dirname, 'popupblock.js'), 'utf8'),
  mysteryhide: fs.readFileSync(path.join(__dirname, 'mysteryhide.js'), 'utf8'),
};
ipcMain.on('wl:scripts', e => { e.returnValue = frameScripts; });

/* ================= منع النوافذ المنبثقة ================= */
// تصاريح النوافذ: preload بيدي تصريح قبل كل window.open من الواجهة، وصالح لثانية واحدة
let openGrants = [];
ipcMain.on('wl:allowOpen', e => {
  if (fromApp(e)) openGrants.push(Date.now() + 1000);
  e.returnValue = true;
});

const webPreferences = {
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  nodeIntegrationInSubFrames: true, // يخلي preload يشتغل جوه iframe البلاير عشان مانع الـ popups
};

// أي نافذة بيفتحها البرنامج (مواقع المشاهدة/التحميل/التريلر) بتفتح جوه البرنامج بنفس الحماية،
// وأي popup من جوه النوافذ دي نفسها بيتمنع
function guardPopups(wc, allowChildren) {
  wc.setWindowOpenHandler(({ url }) => {
    openGrants = openGrants.filter(t => t > Date.now());
    const granted = allowChildren && openGrants.length > 0;
    if (!granted || !/^(https?:|about:blank)/.test(url)) return { action: 'deny' };
    openGrants.shift();
    return {
      action: 'allow',
      overrideBrowserWindowOptions: { width: 1280, height: 800, autoHideMenuBar: true, icon: path.join(__dirname, 'icon128.png'), webPreferences },
    };
  });
  wc.on('did-create-window', child => guardPopups(child.webContents, false));
}

/* ================= النافذة والـ tray ================= */
let win, tray, quitting = false;

/* ================= إشعارات (مواسم جديدة) ================= */
// لازم نحتفظ بمرجع للإشعار — لو الـ GC شاله، الضغط عليه مبيعملش حاجة
const liveNotifications = new Set();
const clip = (s, n) => (typeof s === 'string' ? s : '').slice(0, n);
ipcMain.handle('wl:notify', (e, p) => {
  if (!fromApp(e)) throw new Error('forbidden');
  if (!p || typeof p !== 'object') throw new Error('bad payload');
  const title = clip(p.title, 80).trim();
  const body = clip(p.body, 240);
  const itemId = typeof p.itemId === 'string' && /^[\w-]{1,40}$/.test(p.itemId) ? p.itemId : null;
  if (!title) throw new Error('bad payload');
  if (!Notification.isSupported()) return false;
  const n = new Notification({ title, body, icon: path.join(__dirname, 'icon128.png') });
  liveNotifications.add(n);
  const done = () => liveNotifications.delete(n);
  n.on('click', () => {
    done();
    show();
    if (itemId) win.webContents.send('wl:openItem', itemId);
  });
  n.on('close', done);
  n.show();
  return true;
});

function updateBadge() {
  let n = 0;
  try { n = JSON.parse(store['watchlist:data'] || '[]').filter(i => i && i.status === 'queue').length; } catch (e) {}
  // ponytail: tooltip بس — ويندوز مفيهوش badge رقمي؛ overlay icon لو احتجناه
  const base = `rilio v${app.getVersion()}`;
  tray && tray.setToolTip(n ? `${base} — ${n} هشوفهم` : base);
}

function show() { win.show(); win.focus(); }

/* ================= شريط النافذة بلون المزاج ================= */
// أزرار ويندوز الأصلية بتفضل، بس بلون المزاج. الواجهة بتبعت اسم المزاج بس — مفيش ألوان جاية من برا
const MOODS = {
  sahra: { bar: '#130F1A', sym: '#A99CB8', bg: '#15111C' },
  mint: { bar: '#0B1615', sym: '#8FB3AA', bg: '#0D1918' },
  coffee: { bar: '#140E0B', sym: '#B59F8C', bg: '#19120F' },
  sunrise: { bar: '#F6EBDD', sym: '#6E5F78', bg: '#FBF3E8' },
};
const OLD_THEMES = { cinema: 'sahra', nova: 'sahra', midnight: 'mint', ember: 'coffee' };
const moodOf = t => MOODS[OLD_THEMES[t] || t] || MOODS.sahra;
ipcMain.handle('wl:titlebar', (e, t) => {
  if (!fromApp(e)) throw new Error('forbidden');
  if (typeof t !== 'string' || !Object.hasOwn(MOODS, t)) throw new Error('bad payload');
  const m = MOODS[t];
  if (win.setTitleBarOverlay) win.setTitleBarOverlay({ color: m.bar, symbolColor: m.sym, height: 40 });
  win.setBackgroundColor(m.bg);
  return true;
});

function createWindow() {
  const mood = moodOf(store['watchlist:theme']);
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 900, minHeight: 600,
    backgroundColor: mood.bg, autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: mood.bar, symbolColor: mood.sym, height: 40 },
    icon: path.join(__dirname, 'icon.ico'),
    title: 'rilio',
    webPreferences,
  });
  guardPopups(win.webContents, true);
  // الإعلانات بتحاول تعمل top.location = إعلان — الواجهة متتنقلش أبداً برا ملفاتها
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(APP_ORIGIN)) e.preventDefault(); });
  win.loadURL(APP_ORIGIN + 'app.html');
  // زرار X بيصغّر للـ tray بدل ما يقفل
  win.on('close', e => { if (!quitting) { e.preventDefault(); win.hide(); } });
}

app.on('second-instance', () => win && show());
app.on('before-quit', () => { quitting = true; });

// سيرفر الـ Watch Party: من package.json — والـ override بالـ env للتست بس (مش في النسخة المتثبتة)
function partyServerUrl() {
  const dev = !app.isPackaged && process.env.WL_PARTY_URL;
  const url = dev || require('./package.json').partyServer || '';
  if (/^wss:\/\/[^/\s]+$/.test(url)) return url;
  if (dev && /^ws:\/\/127\.0\.0\.1:\d+$/.test(url)) return url;
  return '';
}

app.whenReady().then(() => {
  protocol.handle('app', req => {
    const { host, pathname } = new URL(req.url);
    const name = decodeURIComponent(pathname).replace(/^\/+/, '');
    // قايمة ملفات ثابتة — مفيش path traversal ممكن
    if (host !== 'local' || !APP_FILES.has(name)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(path.join(__dirname, name)).toString());
  });

  // Electron بيوافق على كل الصلاحيات افتراضياً — حتى لإعلان جوه iframe (مايك، كاميرا، موقع...)
  const ALLOWED_PERMS = new Set(['fullscreen', 'clipboard-sanitized-write']);
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(ALLOWED_PERMS.has(perm)));
  session.defaultSession.setPermissionCheckHandler((wc, perm) => ALLOWED_PERMS.has(perm));

  createWindow();
  initParty({ getWindow: () => win, serverUrl: partyServerUrl(), fromApp });
  tray = new Tray(path.join(__dirname, 'icon.ico'));
  const updater = initUpdater({
    onChange: st => {
      buildTrayMenu();
      if (win && !win.isDestroyed()) win.webContents.send('wl:update:state', st);
    },
  });
  function buildTrayMenu() {
    const st = updater.getState();
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: `النسخة ${app.getVersion()}`, enabled: false },
      { type: 'separator' },
      { label: 'افتح rilio', click: show },
      st.status === 'downloaded'
        ? { label: `أعد التشغيل للتحديث (${st.version})`, click: updater.install }
        : { label: st.status === 'downloading' ? `بينزّل التحديث ${st.percent}%` : st.status === 'checking' ? 'بدوّر على تحديث...' : 'دوّر على تحديثات',
            enabled: st.status !== 'downloading' && st.status !== 'checking', click: checkFromTray },
      { label: 'خروج', click: () => app.quit() },
    ]));
  }
  // من الـ tray مفيش واجهة — النتيجة بتظهر كإشعار ويندوز
  async function checkFromTray() {
    const st = await updater.check();
    const body = {
      'up-to-date': `إنت على آخر نسخة (${st.current}) ✔`,
      downloading: `فيه نسخة جديدة ${st.version} — بتنزل دلوقتي، وهقولك لما تجهز`,
      downloaded: `نسخة ${st.version} جاهزة — اختار "أعد التشغيل للتحديث" من القايمة`,
      error: st.error === 'OFFLINE' ? 'معرفتش أوصل لسيرفر التحديثات — اتأكد من النت' : 'حصلت مشكلة وأنا بدوّر على تحديث — جرّب تاني بعد شوية',
      dev: 'التحديث التلقائي بيشتغل في النسخة المتثبّتة بس',
    }[st.status];
    if (body && Notification.isSupported()) new Notification({ title: 'rilio', body }).show();
  }

  // الواجهة: تقرا الحالة، تطلب فحص، أو تثبّت — التثبيت بيحصل بس لو التحديث نازل ومتأكد منه
  ipcMain.handle('wl:update:get', e => { if (!fromApp(e)) throw new Error('forbidden'); return updater.getState(); });
  ipcMain.handle('wl:update:check', e => { if (!fromApp(e)) throw new Error('forbidden'); return updater.check(); });
  ipcMain.handle('wl:update:install', e => { if (!fromApp(e)) throw new Error('forbidden'); return updater.install(); });
  buildTrayMenu();
  tray.on('click', show);
  updateBadge();
});
