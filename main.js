// نسخة الديسكتوب — نفس app.html/app.js بتاعة الاكستنشن، والـ chrome.storage بيتعمله shim في preload.js
const { app, BrowserWindow, ipcMain, Tray, Menu, protocol, net, session } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { initUpdater } = require('./updater');

if (!app.requestSingleInstanceLock()) app.quit();
// لازم يطابق appId في package.json عشان إشعارات ويندوز تظهر
app.setAppUserModelId('com.watchlist.desktop');

// الواجهة بتتحمل من app://local بدل file:// — صفحة file:// تقدر تقرا أي ملف على الجهاز لو حصل فيها injection
const APP_ORIGIN = 'app://local/';
const APP_FILES = new Set(['app.html', 'app.js', 'icon16.png', 'icon48.png', 'icon128.png']);
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true } }]);

/* ================= التخزين ================= */
const DB = path.join(app.getPath('userData'), 'storage.json');
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

ipcMain.handle('wl:get', (e, keys) => {
  if (!fromApp(e)) throw new Error('forbidden');
  if (keys == null) return store;
  const out = {};
  for (const k of [].concat(keys)) if (typeof k === 'string' && Object.hasOwn(store, k)) out[k] = store[k];
  return out;
});

ipcMain.handle('wl:set', (e, obj) => {
  if (!fromApp(e)) throw new Error('forbidden');
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('bad payload');
  const changes = {};
  const next = { ...store };
  for (const [k, v] of Object.entries(obj)) {
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

function updateBadge() {
  let n = 0;
  try { n = JSON.parse(store['watchlist:data'] || '[]').filter(i => i && i.status === 'queue').length; } catch (e) {}
  // ponytail: tooltip بس — ويندوز مفيهوش badge رقمي؛ overlay icon لو احتجناه
  tray && tray.setToolTip(n ? `قائمة المشاهدة — ${n} هشوفهم` : 'قائمة المشاهدة');
}

function show() { win.show(); win.focus(); }

function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 900, minHeight: 600,
    backgroundColor: '#0b0b10', autoHideMenuBar: true,
    icon: path.join(__dirname, 'icon128.png'),
    title: 'قائمة المشاهدة',
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
  tray = new Tray(path.join(__dirname, 'icon16.png'));
  let readyVersion = null;
  const updater = initUpdater({ onReady: v => { readyVersion = v; buildTrayMenu(); } });
  function buildTrayMenu() {
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'افتح القايمة', click: show },
      ...(readyVersion ? [{ label: `أعد التشغيل للتحديث (${readyVersion})`, click: updater.install }] : []),
      { label: 'خروج', click: () => app.quit() },
    ]));
  }
  buildTrayMenu();
  tray.on('click', show);
  updateBadge();
});
