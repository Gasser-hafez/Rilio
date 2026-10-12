const { contextBridge, ipcRenderer } = require('electron');

if (process.isMainFrame && location.origin === 'app://local') {
  // واجهة البرنامج نفسها: shim لـ chrome.storage.local عشان app.js يشتغل من غير تعديل
  const listeners = [];
  ipcRenderer.on('wl:changed', (e, changes) => listeners.forEach(fn => fn(changes, 'local')));
  contextBridge.exposeInMainWorld('__wlStorage', {
    local: {
      get: keys => ipcRenderer.invoke('wl:get', keys),
      set: obj => ipcRenderer.invoke('wl:set', obj),
    },
    onChanged: { addListener: fn => listeners.push(fn) },
  });
  // ترشيحات الـ AI — الطلب بيتعمل في main، والمفتاح مبيرجعش للواجهة
  contextBridge.exposeInMainWorld('__wlAi', {
    get: () => ipcRenderer.invoke('wl:aiGet'),
    set: cfg => ipcRenderer.invoke('wl:aiSet', cfg),
    run: prompt => ipcRenderer.invoke('wl:aiRun', prompt),
    models: cfg => ipcRenderer.invoke('wl:aiModels', cfg),
    test: cfg => ipcRenderer.invoke('wl:aiTest', cfg),
  });
  contextBridge.exposeInMainWorld('__wlAllowOpen', () => ipcRenderer.sendSync('wl:allowOpen'));
  contextBridge.exposeInMainWorld('__wlDesktop', {
    notify: p => ipcRenderer.invoke('wl:notify', p),
    titlebar: mood => ipcRenderer.invoke('wl:titlebar', mood),
    openExternal: url => ipcRenderer.invoke('wl:openExternal', url),
    update: {
      get: () => ipcRenderer.invoke('wl:update:get'),
      check: () => ipcRenderer.invoke('wl:update:check'),
      install: () => ipcRenderer.invoke('wl:update:install'),
      onState: fn => ipcRenderer.on('wl:update:state', (e, st) => fn(st)),
    },
    onOpenItem: fn => ipcRenderer.on('wl:openItem', (e, id) => fn(id)),
    party: {
      create: () => ipcRenderer.invoke('wl:party:create'),
      join: code => ipcRenderer.invoke('wl:party:join', code),
      leave: () => ipcRenderer.invoke('wl:party:leave'),
      setMedia: m => ipcRenderer.invoke('wl:party:setMedia', m),
      status: () => ipcRenderer.invoke('wl:party:status'),
      onStatus: fn => ipcRenderer.on('wl:party:status', (e, st) => fn(st)),
      onMedia: fn => ipcRenderer.on('wl:party:media', (e, m) => fn(m)),
    },
  });
  contextBridge.executeInMainWorld({
    func: () => {
      // window.chrome موجود أصلاً في Chromium فمينفعش نعمله expose — بنضيف storage جواه
      (window.chrome ||= {}).storage = window.__wlStorage;
      // أي window.open من الواجهة نفسها بياخد تصريح؛ أي نافذة من غير تصريح (لينكات إعلانات في iframe البلاير) بتتمنع
      const open = window.open;
      window.open = function (...a) { window.__wlAllowOpen(); return open.apply(window, a); };
    },
  });
} else {
  // أي فريم أو صفحة خارجية (البلاير، مواقع المشاهدة): نفس سكريبتات الاكستنشن
  const s = ipcRenderer.sendSync('wl:scripts');
  // popupblock لازم يشتغل في عالم الصفحة نفسها قبل أي سكريبت
  contextBridge.executeInMainWorld({ func: new Function(s.popupblock) });
  new Function(s.mysteryhide)();
  partyVideoController();
}

// Watch Party: بيمسك الـ <video> الأساسي في الفريم ده (لو فيه)، يبعت ضغطات المستخدم لـ main،
// ويطبّق الأوامر الجاية من الأوضة. شغال في الـ isolated world فالصفحة مبتشوفهوش
function partyVideoController() {
  const SEEK_TOLERANCE_S = 1.5;
  const STARTUP_IGNORE_MS = 1500; // أول تشغيل لما الفيديو يتمسك بيتبعت مع ready مش كضغطة
  const GESTURE_WINDOW_MS = 2000; // play/pause/seek بعد ضغطة حقيقية بثانيتين = من المستخدم
  let video = null, attachedAt = 0, desired = null, lastGesture = 0;

  // ضغطات حقيقية بس (isTrusted) — البلاير ساعات بيوقّف/يقدّم لوحده (استكمال من آخر مكان، إعلانات)
  // وده مينفعش يتبعت للأوضة كأن حد ضغط
  for (const ev of ['pointerdown', 'pointerup', 'keydown']) {
    document.addEventListener(ev, e => { if (e.isTrusted) lastGesture = Date.now(); }, true);
  }

  const target = () => !desired ? 0 : desired.paused ? desired.pos : desired.pos + (Date.now() - desired.sentAt) / 1000;
  const matchesDesired = () => !!desired && video.paused === desired.paused && Math.abs(video.currentTime - target()) < SEEK_TOLERANCE_S;

  function pick() {
    let best = null;
    for (const v of document.querySelectorAll('video')) if (v.duration > 0 && (!best || v.duration > best.duration)) best = v;
    return best;
  }

  function apply() {
    if (!video || !desired) return;
    const t = target();
    if (Math.abs(video.currentTime - t) > SEEK_TOLERANCE_S) video.currentTime = t;
    if (desired.paused && !video.paused) video.pause();
    else if (!desired.paused && video.paused) video.play().catch(() => {});
  }

  function onLocal() {
    if (Date.now() - attachedAt < STARTUP_IGNORE_MS || matchesDesired()) return;
    if (Date.now() - lastGesture < GESTURE_WINDOW_MS) {
      ipcRenderer.send('wl:party:local', { paused: video.paused, pos: video.currentTime });
    } else {
      apply(); // البلاير غيّر لوحده → نرجّعه لحالة الأوضة
    }
  }

  function attach(v) {
    video = v; attachedAt = Date.now();
    for (const ev of ['play', 'pause', 'seeked']) v.addEventListener(ev, onLocal);
    ipcRenderer.send('wl:party:ready', { duration: v.duration, paused: v.paused, pos: v.currentTime });
  }

  ipcRenderer.on('wl:party:cmd', (e, cmd) => {
    if (!cmd || typeof cmd.paused !== 'boolean' || !Number.isFinite(cmd.pos) || !Number.isFinite(cmd.sentAt)) return;
    desired = cmd;
    apply();
  });

  setInterval(() => {
    const v = pick();
    if (v && v !== video) attach(v);
  }, 500);
}
