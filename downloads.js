// مدير التنزيلات + المكتبة المحلية — جزء الـ main process
// بيمسك بس التنزيلات اللي بتبدأ من نوافذ المواقع (اللي المستخدم ضايفها). تنزيلات الواجهة نفسها (النسخة الاحتياطية) زي ما هي.
// الفولدر متخزن في ملف خاص بـ main مش في storage.json: نسخة احتياطية أو ملف إعدادات متلغّم ميقدرش يوجّه التنزيلات لأي فولدر
const { ipcMain, dialog, shell, Notification, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const { randomBytes } = require('crypto');
const { Readable } = require('stream');
const { extractSubs, spliced } = require('./mkvsubs');

// اللي بيتشغّل جوه البرنامج (Chromium بيشغّله)
const MEDIA = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav' };
// اللي مسموح يتنزل: ميديا + ترجمة + أرشيف. أي حاجة تانية (exe, msi, bat, scr, lnk, js...) بتتلغي — المواقع دي مليانة برامج ضارة
const ALLOWED = new Set([...Object.keys(MEDIA), '.avi', '.ts', '.srt', '.vtt', '.ass', '.ssa', '.sub', '.zip', '.rar', '.7z']);
const extOf = n => path.extname(n).toLowerCase();
// ترجمة جنب الفيلم بنفس الاسم: Movie.mkv ← Movie.srt / Movie.ar.srt / Movie.en.vtt
const SUBS = new Set(['.srt', '.vtt']);
const stem = n => n.slice(0, n.length - extOf(n).length);
// srt → WebVTT (الـ <track> بيفهم vtt بس). ملفات الترجمة العربي كتير منها Windows-1256 مش UTF-8
function toVtt(buf, ext) {
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { text = new TextDecoder('windows-1256').decode(buf); }
  text = text.replace(/^﻿/, '').replace(/\r/g, '');
  return ext === '.vtt' ? text : 'WEBVTT\n\n' + text.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
}
// ملف تشغيل متنكر (movie.mp4 بس السيرفر بيقول إنه برنامج) — بيتمنع حتى لو الامتداد مسموح
const EXE_MIME = /^application\/(x-msdownload|x-msdos-program|x-dosexec|vnd\.microsoft\.portable-executable|x-ms-installer|x-msi)\b/i;

// اسم ملف آمن: من غير مسارات ولا حروف ممنوعة في ويندوز ولا أسماء محجوزة (CON, NUL...)
function safeName(n) {
  let s = path.basename(String(n || '')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^[.\s]+|[.\s]+$/g, '');
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(s)) s = '_' + s;
  if (s.length > 150) s = s.slice(0, 140) + extOf(s).slice(0, 10);
  return s || 'download';
}

const LIB_DEPTH = 3, LIB_MAX = 3000; // فولدرات فرعية لحد 3 مستويات (المسلسل/الموسم/الحلقة)
const PART = '.wlpart'; // اسم تاني (hard link) للملف الناقص — Electron بيمسح الناقص لما البرنامج يقفل

function initDownloads({ session, protocol, getWindow, fromApp, isSiteWindow, settingsPath, defaultDir, getStore, osBase, appVersion }) {
  const token = randomBytes(16).toString('hex'); // لينكات المكتبة: إعلان في iframe مايقدرش يخمّنها
  const dls = new Map(); // id → { id, name, file, item, state, asking }
  const restoring = new Map(); // مسار → بيانات تنزيل راجع من تشغيل قبل كده
  let seq = 0, pushTimer = null, quitting = false;
  const liveNotes = new Set(); // لازم مرجع للإشعار — لو الـ GC شاله، الضغط عليه مبيعملش حاجة
  const statePath = path.join(path.dirname(settingsPath), 'dlstate.json');

  let dir = defaultDir;
  try { const s = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); if (typeof s.dir === 'string' && path.isAbsolute(s.dir)) dir = s.dir; } catch (e) {}

  const toApp = (ch, p) => { const w = getWindow(); if (w && !w.isDestroyed()) w.webContents.send(ch, p); };
  const view = d => ({
    id: d.id, name: d.name, received: d.item.getReceivedBytes(), total: d.item.getTotalBytes(),
    state: d.asking ? 'confirm' : d.state === 'progressing' && d.item.isPaused() ? 'paused' : d.state,
    speed: d.state === 'progressing' && !d.asking && !d.item.isPaused() ? Math.round(d.speed || 0) : 0, // بايت/ثانية
  });
  const list = () => [...dls.values()].reverse().map(view);
  const unfinished = () => [...dls.values()].filter(d => !d.asking && (d.state === 'progressing' || d.state === 'interrupted'));

  // التنزيلات اللي لسه مخلصتش بتتحفظ أول بأول — لو البرنامج اتقفل (أو وقع) بتكمّل في التشغيل الجاي
  function saveState() {
    if (quitting) return; // Electron بيلغي التنزيلات وهو بيقفل — دي مش إلغاء من المستخدم، الحالة اللي اتحفظت قبل القفل هي الصح
    const recs = unfinished().map(d => ({
      path: d.file, urlChain: d.item.getURLChain(), mimeType: d.item.getMimeType(), offset: d.item.getReceivedBytes(),
      length: d.item.getTotalBytes(), lastModified: d.item.getLastModifiedTime(), eTag: d.item.getETag(), startTime: d.item.getStartTime(),
    }));
    try { fs.writeFileSync(statePath, JSON.stringify(recs)); } catch (e) {}
  }
  const push = () => { if (!pushTimer) pushTimer = setTimeout(() => { pushTimer = null; toApp('wl:dl:list', list()); saveState(); }, 300); };

  function uniquePath(name) {
    const taken = p => fs.existsSync(p) || fs.existsSync(p + PART) || [...dls.values()].some(d => d.file === p);
    const ext = extOf(name), base = name.slice(0, name.length - ext.length);
    let p = path.join(dir, name);
    for (let i = 1; taken(p); i++) p = path.join(dir, `${base} (${i})${ext}`);
    return p;
  }

  function attach(d) {
    const { item } = d;
    dls.set(d.id, d);
    item.on('updated', (ev, st) => {
      d.state = st;
      // السرعة: متوسط متحرك كل ثانية (عشان الرقم ميرقصش)
      const now = Date.now(), got = item.getReceivedBytes();
      if (!d.t0 || item.isPaused()) { d.t0 = now; d.b0 = got; }
      else if (now - d.t0 >= 1000) {
        const inst = (got - d.b0) / ((now - d.t0) / 1000);
        d.speed = d.speed == null ? inst : d.speed * 0.7 + inst * 0.3;
        d.t0 = now; d.b0 = got;
      }
      push();
    });
    item.once('done', (ev, st) => {
      d.state = st; push();
      if (!quitting) try { fs.rmSync(d.file + PART, { force: true }); } catch (e) {}
      // ملف صغير ممكن يخلص قبل ما المستخدم يوافق (الإيقاف مبيوقفش اللي وصل خلاص) — يستنى الموافقة، و"لأ" بتمسحه
      if (d.asking) { d.doneEarly = st; return; }
      finish(d);
    });
  }
  async function finish(d) {
    if (d.state !== 'completed') return;
    // سيرفرات بتقول إنها بتكمّل من النص وهي بتبعت الفيلم من الأول → ملف متكرر جواه. بنقول بدل ما المستخدم يتفاجئ وهو بيتفرج
    if (await isSpliced(d.file)) { d.state = 'broken'; push(); toApp('wl:dl:event', { kind: 'broken', name: d.name }); return; }
    toApp('wl:dl:event', { kind: 'done', name: d.name });
    // البرنامج مش قدامك (في الـ tray أو بتتفرج على حاجة تانية) → إشعار ويندوز؛ الضغط عليه بيفتح تنزيلاتي
    const w = getWindow();
    if (Notification.isSupported() && !(w && !w.isDestroyed() && w.isVisible() && w.isFocused())) {
      const n = new Notification({ title: '✔ خلص التنزيل', body: d.name.slice(0, 200) });
      liveNotes.add(n);
      n.on('click', () => { liveNotes.delete(n); if (w && !w.isDestroyed()) { w.show(); w.focus(); } toApp('wl:dl:event', { kind: 'open' }); });
      n.on('close', () => liveNotes.delete(n));
      n.show();
    }
  }
  session.on('will-download', (e, item, wc) => {
    // تنزيل راجع من تشغيل قبل كده (createInterruptedDownload) — المستخدم وافق عليه ساعتها
    const rec = restoring.get(item.getSavePath());
    if (rec) {
      restoring.delete(item.getSavePath());
      const d = { id: ++seq, name: path.basename(rec.path), file: rec.path, item, state: 'interrupted', asking: false };
      attach(d);
      if (item.canResume()) item.resume();
      push();
      return;
    }
    if (!wc || !isSiteWindow(wc)) return; // تنزيلات الواجهة: حفظ ويندوز العادي
    const name = safeName(item.getFilename());
    // نافذة فاضية اتفتحت للتنزيل بس — تتقفل
    const closeBlank = () => { if (!wc.isDestroyed() && /^(about:blank)?$/.test(wc.getURL())) wc.close(); };
    if (!ALLOWED.has(extOf(name)) || EXE_MIME.test(item.getMimeType())) {
      e.preventDefault();
      toApp('wl:dl:event', { kind: 'blocked', name });
      closeBlank();
      return;
    }
    try { fs.mkdirSync(dir, { recursive: true }); } catch (err) {}
    const file = uniquePath(name);
    item.setSavePath(file);
    // مبيبدأش غير لما المستخدم يشوف الاسم والحجم ويوافق (الواجهة بتسأله — wl:dl:ask)
    item.pause();
    const d = { id: ++seq, name: path.basename(file), file, item, state: 'progressing', asking: true };
    attach(d);
    let host = '';
    try { host = new URL(item.getURL()).hostname; } catch (err) {}
    const w = getWindow();
    if (w && !w.isDestroyed()) { w.show(); w.focus(); }
    toApp('wl:dl:ask', { id: d.id, name: d.name, size: item.getTotalBytes(), host, ext: extOf(d.name) });
    push();
    closeBlank();
  });

  // التنزيلات اللي مخلصتش في التشغيل اللي فات: نرجّع الملف الناقص (من الـ hard link لو Electron مسحه) ونكمّل من عنده.
  // الملف ده بتاع main بس، بس برضو منقبلش منه غير مسار جوه فولدر التنزيلات وامتداد مسموح ولينكات http(s)
  {
    let recs = [];
    try { recs = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch (e) {}
    for (const r of Array.isArray(recs) ? recs.slice(0, 50) : []) {
      if (!r || typeof r.path !== 'string' || path.dirname(r.path) !== dir || !ALLOWED.has(extOf(r.path))) continue;
      if (!Array.isArray(r.urlChain) || !r.urlChain.length || !r.urlChain.every(u => typeof u === 'string' && /^https?:\/\//.test(u))) continue;
      try {
        if (!fs.existsSync(r.path) && fs.existsSync(r.path + PART)) fs.renameSync(r.path + PART, r.path);
        else fs.rmSync(r.path + PART, { force: true });
        if (!fs.existsSync(r.path)) continue;
        restoring.set(r.path, r);
        session.createInterruptedDownload({
          path: r.path, urlChain: r.urlChain, mimeType: String(r.mimeType || ''), offset: fs.statSync(r.path).size,
          length: Number(r.length) || 0, lastModified: String(r.lastModified || ''), eTag: String(r.eTag || ''), startTime: Number(r.startTime) || undefined,
        });
      } catch (e) { restoring.delete(r.path); }
    }
  }

  // قبل ما البرنامج يقفل: Electron بيلغي التنزيلات اللي شغالة ويمسح ملفاتها — hard link بيحافظ على البيانات (لحظي، من غير نسخ)
  function beforeQuit() {
    saveState();
    quitting = true;
    for (const d of unfinished()) {
      try { fs.rmSync(d.file + PART, { force: true }); fs.linkSync(d.file, d.file + PART); } catch (e) {}
    }
  }

  // مسار جوه فولدر التنزيلات (المكتبة فيها فولدرات فرعية) — من غير .. ولا مسارات كاملة ولا symlink يطلع برا
  function libFile(rel, exts) {
    if (typeof rel !== 'string' || !rel || rel.length > 500) return null;
    const parts = rel.split(/[\\/]/);
    if (parts.length > LIB_DEPTH + 1 || parts.some(p => !p || p === '.' || p === '..' || p.includes(':'))) return null;
    if (!exts(extOf(rel))) return null;
    const file = path.join(dir, ...parts);
    try {
      const root = fs.realpathSync(dir), real = fs.realpathSync(file);
      if (!real.startsWith(root + path.sep)) return null;
    } catch (e) { return null; }
    return file;
  }
  const isMediaOrSub = x => !!MEDIA[x] || SUBS.has(x);

  // المكتبة: ملفات الميديا في فولدر التنزيلات وفولداته الفرعية. name = المسار النسبي ("The Boys/Season 2/E05.mkv")
  async function library() {
    const out = [];
    let seen = 0;
    // ملفات لسه بتتنزّل (أو مستنية موافقة) — بتظهر في المكتبة بحالتها مش كأنها خلصت
    const busy = new Set([...dls.values()].filter(d => d.asking || d.state === 'progressing' || d.state === 'interrupted').map(d => d.file));
    async function walk(rel, depth) {
      let ents = [];
      try { ents = await fs.promises.readdir(path.join(dir, ...rel), { withFileTypes: true }); } catch (e) { return; }
      const files = ents.filter(x => x.isFile()).map(x => x.name);
      for (const ent of ents) {
        if (++seen > LIB_MAX) return;
        if (ent.isDirectory()) { if (depth < LIB_DEPTH && !ent.name.startsWith('.')) await walk([...rel, ent.name], depth + 1); continue; }
        if (!ent.isFile() || !MEDIA[extOf(ent.name)]) continue;
        const name = [...rel, ent.name].join('/');
        try {
          const st = await fs.promises.stat(path.join(dir, ...rel, ent.name));
          const subs = files.filter(n => SUBS.has(extOf(n)) && stem(n).toLowerCase().startsWith(stem(ent.name).toLowerCase()))
            .map(n => ({ label: stem(n).slice(stem(ent.name).length).replace(/^[.\s_-]+/, '').slice(0, 20) || 'ترجمة', url: `wlmedia://lib/${token}/${encodeURIComponent([...rel, n].join('/'))}` }));
          out.push({ name, size: st.size, mtime: st.mtimeMs, url: `wlmedia://lib/${token}/${encodeURIComponent(name)}`, subs,
            downloading: busy.has(path.join(dir, ...rel, ent.name)) });
        } catch (e) {}
      }
    }
    await walk([], 0);
    return out.sort((a, b) => b.mtime - a.mtime);
  }

  // تشغيل ملفات المكتبة في <video>: بالتوكن + مسار جوه الفولدر بس + Range عشان التقديم
  protocol.handle('wlmedia', async req => {
    const notFound = () => new Response('Not found', { status: 404 });
    const u = new URL(req.url);
    const [tok, enc, extra] = u.pathname.slice(1).split('/');
    let rel = '';
    try { rel = decodeURIComponent(enc || ''); } catch (e) { return notFound(); }
    if (u.host !== 'lib' || tok !== token || extra !== undefined) return notFound();
    const file = libFile(rel, isMediaOrSub);
    if (!file) return notFound();
    // الواجهة (app://local) بتحمّل الفيديو والترجمة بـ crossorigin عشان الـ <track> يشتغل
    const cors = { 'Access-Control-Allow-Origin': 'app://local' };
    let st;
    try { st = await fs.promises.stat(file); } catch (e) { return notFound(); }
    if (!st.isFile()) return notFound();
    if (SUBS.has(extOf(rel))) {
      if (st.size > 5e6) return notFound();
      return new Response(toVtt(await fs.promises.readFile(file), extOf(rel)), { headers: { ...cors, 'Content-Type': 'text/vtt; charset=utf-8' } });
    }
    const headers = { ...cors, 'Content-Type': MEDIA[extOf(rel)], 'Accept-Ranges': 'bytes' };
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') || '');
    let start = 0, end = st.size - 1;
    if (m) {
      if (m[1]) { start = +m[1]; if (m[2]) end = Math.min(+m[2], end); }
      else if (m[2]) start = Math.max(0, st.size - +m[2]);
      if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${st.size}` } });
      headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
    }
    headers['Content-Length'] = String(end - start + 1);
    const body = st.size ? Readable.toWeb(fs.createReadStream(file, { start, end })) : null;
    return new Response(body, { status: m ? 206 : 200, headers });
  });

  /* ---------- IPC من الواجهة ---------- */
  const guard = e => { if (!fromApp(e)) throw new Error('forbidden'); };
  ipcMain.handle('wl:dl:state', async e => { guard(e); return { dir, items: list(), library: await library() }; });
  ipcMain.handle('wl:dl:act', (e, id, act) => {
    guard(e);
    const d = dls.get(id);
    if (!d) return false;
    if (act === 'start' && d.asking) {
      d.asking = false;
      toApp('wl:dl:event', { kind: 'started', name: d.name });
      if (d.doneEarly) finish(d); else d.item.resume();
    }
    else if (act === 'cancel' && d.asking && d.doneEarly) { d.asking = false; d.state = 'cancelled'; try { fs.rmSync(d.file, { force: true }); } catch (err) {} }
    else if (d.asking && act !== 'cancel') return false; // لازم موافقة الأول
    else if (act === 'pause' && d.state === 'progressing' && !d.item.isPaused()) { d.item.pause(); d.speed = null; }
    else if (act === 'resume' && (d.item.isPaused() || d.state === 'interrupted') && d.item.canResume()) d.item.resume();
    else if (act === 'cancel' && (d.state === 'progressing' || d.state === 'interrupted')) {
      d.asking = false; d.item.cancel();
      // تنزيل راجع ومش قادر يكمّل: الإلغاء بيشيل الملف الناقص كمان
      if (d.state === 'interrupted') try { fs.rmSync(d.file, { force: true }); } catch (err) {}
    }
    else if (act === 'show' && d.state === 'completed') shell.showItemInFolder(d.file);
    else return false;
    push();
    return true;
  });
  // فحص الملف المتلزّق مرة واحدة لكل نسخة من الملف (الحجم + وقت التعديل)
  const splicedCache = new Map();
  async function isSpliced(file) {
    try {
      const st = await fs.promises.stat(file), key = file + '|' + st.size + '|' + st.mtimeMs;
      if (!splicedCache.has(key)) splicedCache.set(key, await spliced(file));
      return splicedCache.get(key);
    } catch (e) { return false; }
  }
  ipcMain.handle('wl:dl:check', async (e, rel) => {
    guard(e);
    const file = libFile(rel, x => !!MEDIA[x]);
    return file ? isSpliced(file) : false;
  });

  /* ---------- الترجمة: جنب الفيلم ← جوه الملف (MKV) ← أونلاين (OpenSubtitles) ---------- */
  // بيانات كل ملف ترجمة (جاي منين، لغته، اسم النسخة، نفس نسختك ولا لأ) — ملف خاص بـ main، الواجهة بتقراه بس
  const META = path.join(path.dirname(settingsPath), 'subsmeta.json');
  let subMeta = {};
  try { const m = JSON.parse(fs.readFileSync(META, 'utf8')); if (m && typeof m === 'object') subMeta = m; } catch (e) {}
  const saveMeta = () => { try { fs.writeFileSync(META, JSON.stringify(subMeta)); } catch (e) {} };
  const SUB_LANG = /^(ar|en|fr|es|de|it|pt|tr|ru|ja|ko|zh|hi|fa|he|nl)(?![a-z])/i;
  const clip = (s, n) => String(s || '').replace(/[\x00-\x1f]/g, ' ').slice(0, n);
  // ترجمات جنب ملف (نفس الفولدر، الاسم بيبدأ باسمه) — نفس اللي المكتبة بتعرضه
  async function sidecars(file) {
    const folder = path.dirname(file), base = path.basename(file);
    const rel = path.relative(dir, folder).split(path.sep).filter(Boolean);
    let names = [];
    try { names = await fs.promises.readdir(folder); } catch (e) { return []; }
    return names.filter(n => SUBS.has(extOf(n)) && stem(n).toLowerCase().startsWith(stem(base).toLowerCase())).map(n => {
      const m = subMeta[path.join(folder, n)] || {}, suffix = stem(n).slice(stem(base).length).replace(/^[.\s_-]+/, '');
      return {
        name: [...rel, n].join('/'), label: suffix.slice(0, 20) || 'ترجمة',
        lang: m.lang || ((SUB_LANG.exec(suffix) || [])[1] || '').toLowerCase(),
        src: m.src || 'side', release: clip(m.release, 120), exact: !!m.exact, hi: !!m.hi,
        url: `wlmedia://lib/${token}/${encodeURIComponent([...rel, n].join('/'))}`,
      };
    });
  }
  // اسم ملف ترجمة جديد جنب الفيلم من غير ما نكتب فوق حاجة موجودة: Movie.ar.srt, Movie.ar-2.srt ...
  function subPath(file, label) {
    const s = path.join(path.dirname(file), stem(path.basename(file)) + '.' + (label || 'sub'));
    let p = s + '.srt';
    for (let i = 2; fs.existsSync(p); i++) p = `${s}-${i}.srt`;
    return p;
  }
  const embeddedTried = new Set(), extracting = new Map();
  // الترجمة اللي جوه MKV/WebM → ملفات srt جنب الفيلم (مرة واحدة — المرات الجاية بتبقى جاهزة، وأي بلاير تاني بيشوفها)
  async function embedded(file) {
    if (!/^\.(mkv|webm)$/.test(extOf(file)) || embeddedTried.has(file)) return [];
    if (!extracting.has(file)) extracting.set(file, (async () => {
      try {
        const tracks = await extractSubs(file);
        for (const t of tracks) {
          const out = subPath(file, t.lang);
          fs.writeFileSync(out, t.srt);
          subMeta[out] = { src: 'file', lang: t.lang, release: clip(t.name, 120) };
        }
        if (tracks.length) saveMeta();
        return tracks.length;
      } catch (e) { return 0; } finally { embeddedTried.add(file); extracting.delete(file); }
    })());
    await extracting.get(file);
    return sidecars(file);
  }
  ipcMain.handle('wl:dl:subs', async (e, rel) => {
    guard(e);
    const file = libFile(rel, x => !!MEDIA[x]);
    if (!file) return [];
    const have = await sidecars(file);
    return have.length ? have : embedded(file);
  });
  // مسح ملف ترجمة (مثلاً نسخة توقيتها غلط)
  ipcMain.handle('wl:dl:subDel', async (e, name) => {
    guard(e);
    const f = libFile(name, x => SUBS.has(x));
    if (!f) return false;
    try { fs.rmSync(f, { force: true }); } catch (err) { return false; }
    delete subMeta[f]; saveMeta();
    return true;
  });

  /* ---------- OpenSubtitles ----------
     مفتاح ببلاش من المستخدم (زي TMDB)، واختياري حسابه (20 تنزيل في اليوم بدل 5). الطلبات بأرقام وكود لغة بس —
     مفيش نص من الواجهة غير اسم الملف (حروف وأرقام بس) لو مفيش عنوان مربوط */
  const OS_LANGS = ['ar', 'en'];
  const OS_FILE = path.join(path.dirname(settingsPath), 'opensubs.json'); // اليوزر + الباسورد متشفّر (safeStorage) — مش في storage.json ولا النسخة الاحتياطية
  const osHeaders = key => ({ 'Api-Key': key, 'User-Agent': `rilio v${appVersion}`, Accept: 'application/json', 'Content-Type': 'application/json' });
  const tokens = s => new Set(String(s).toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 1));
  const int = v => (Number.isInteger(v) && v > 0 && v < 1e9 ? v : null);
  const osKey = () => { const k = String(getStore()['watchlist:oskey'] || ''); return /^[A-Za-z0-9]{16,64}$/.test(k) ? k : null; };
  let osToken = null, osTokenAt = 0, osQuota = null; // { remaining, allowed, reset }
  async function osFetch(url, opts) {
    const r = await fetch(url, { ...opts, redirect: 'error', signal: AbortSignal.timeout(20000) });
    if (r.status === 401 || r.status === 403) throw new Error('BAD_KEY');
    if (r.status === 406 || r.status === 429) throw new Error('LIMIT');
    if (!r.ok) throw new Error('HTTP_' + r.status);
    return r;
  }
  function osCreds() {
    try {
      const c = JSON.parse(fs.readFileSync(OS_FILE, 'utf8'));
      if (c && typeof c.user === 'string' && typeof c.pass === 'string') return { user: c.user, pass: safeStorage.decryptString(Buffer.from(c.pass, 'base64')) };
    } catch (e) {}
    return null;
  }
  async function osLogin(key, user, pass) {
    const j = await (await osFetch(`${osBase}/login`, { method: 'POST', headers: osHeaders(key), body: JSON.stringify({ username: user, password: pass }) })).json();
    if (!j || typeof j.token !== 'string' || j.token.length > 4000) throw new Error('BAD_LOGIN');
    osToken = j.token; osTokenAt = Date.now();
    const u = j.user || {}, allowed = Number(u.allowed_downloads) || null;
    osQuota = { allowed, remaining: Number.isFinite(Number(u.remaining_downloads)) ? Number(u.remaining_downloads) : allowed, reset: null };
  }
  // headers بالتوكن لو المستخدم داخل بحسابه (التوكن بيتجدد لوحده)
  async function osAuth(key, fresh) {
    const h = osHeaders(key), c = osCreds();
    if (c) {
      if (fresh || !osToken || Date.now() - osTokenAt > 12 * 3600e3) { try { await osLogin(key, c.user, c.pass); } catch (e) { osToken = null; } }
      if (osToken) h.Authorization = 'Bearer ' + osToken;
    }
    return h;
  }
  // بصمة الملف بتاعة OpenSubtitles (moviehash): الحجم + مجموع أول وآخر 64KB كأرقام 64 بت — بتلاقي ترجمة معمولة على نفس النسخة بالظبط
  function osHash(file) {
    const fd = fs.openSync(file, 'r');
    try {
      const size = fs.fstatSync(fd).size, CH = 65536;
      if (size < CH * 2) return null;
      let h = BigInt(size);
      const buf = Buffer.alloc(CH);
      for (const at of [0, size - CH]) {
        fs.readSync(fd, buf, 0, CH, at);
        for (let i = 0; i < CH; i += 8) h = (h + buf.readBigUInt64LE(i)) & 0xffffffffffffffffn;
      }
      return h.toString(16).padStart(16, '0');
    } finally { fs.closeSync(fd); }
  }
  // كل النتايج (البحث ببلاش — التنزيل بس اللي بيتحسب). q: { tmdbId?, type?, s?, e?, langs? }
  async function osSearch(file, key, q) {
    const langs = Array.isArray(q.langs) && q.langs.length ? OS_LANGS.filter(l => q.langs.includes(l)) : OS_LANGS;
    const tmdb = int(q.tmdbId), s = int(q.s), ep = int(q.e), tv = q.type === 'tv';
    const search = async extra => {
      const params = new URLSearchParams(extra);
      params.set('languages', langs.join(','));
      params.sort(); // OpenSubtitles بيرد 301 لو البارامترات مش بالترتيب الأبجدي (ومش بنتبع redirects بالمفتاح)
      const res = await (await osFetch(`${osBase}/subtitles?${params}`, { headers: osHeaders(key) })).json();
      return Array.isArray(res && res.data) ? res.data : [];
    };
    const hash = osHash(file);
    const exact = hash ? (await search({ moviehash: hash })).filter(d => d && d.attributes && d.attributes.moviehash_match) : [];
    const byId = tmdb && (!tv || (s && ep)) ? (tv ? { parent_tmdb_id: tmdb, season_number: s, episode_number: ep } : { tmdb_id: tmdb }) : null;
    // اسم الملف من غير الامتداد ولا النقط — بس الحروف والأرقام
    const more = await search(byId || { query: stem(path.basename(file)).replace(/[^\p{L}\p{N}]+/gu, ' ').trim().slice(0, 120) });
    // الأحسن: نفس النسخة (البصمة) ← اللغة (عربي قبل إنجليزي) ← اسم الـ release الأقرب لاسم الملف ← الأكتر تنزيلاً
    const mine = tokens(path.basename(file)), seen = new Set();
    return [...exact, ...more].map(d => {
      const a = d && d.attributes || {}, f = Array.isArray(a.files) ? a.files[0] : null;
      if (!f || !int(f.file_id) || !langs.includes(a.language) || seen.has(f.file_id)) return null;
      seen.add(f.file_id);
      const rels = tokens(`${a.release || ''} ${f.file_name || ''}`);
      let match = 0; for (const t of mine) if (rels.has(t)) match++;
      return {
        id: f.file_id, lang: a.language, release: clip(a.release || f.file_name, 160), exact: !!a.moviehash_match, match,
        dl: Number(a.download_count) || 0, rating: Number(a.ratings) || 0, votes: Number(a.votes) || 0, hi: !!a.hearing_impaired,
        trusted: !!a.from_trusted, ai: !!(a.ai_translated || a.machine_translated), fps: Number(a.fps) || 0,
        uploader: clip(a.uploader && a.uploader.name, 40),
      };
    }).filter(Boolean).sort((x, y) => y.exact - x.exact || langs.indexOf(x.lang) - langs.indexOf(y.lang) || y.match - x.match || x.ai - y.ai || x.hi - y.hi || y.dl - x.dl);
  }
  // تنزيل نسخة بعينها (بيتحسب من الحد اليومي) → ملف جنب الفيلم + بياناته
  async function osGet(file, key, c) {
    const body = JSON.stringify({ file_id: c.id, sub_format: 'srt' });
    let res;
    try { res = await osFetch(`${osBase}/download`, { method: 'POST', headers: await osAuth(key), body }); }
    catch (err) { if (err.message !== 'BAD_KEY' || !osCreds()) throw err; res = await osFetch(`${osBase}/download`, { method: 'POST', headers: await osAuth(key, true), body }); } // التوكن خلص
    const dl = await res.json();
    if (dl && Number.isFinite(Number(dl.remaining))) osQuota = { ...(osQuota || {}), remaining: Number(dl.remaining), reset: clip(dl.reset_time_utc, 40) || null };
    if (!dl || typeof dl.link !== 'string' || !/^https?:\/\//.test(dl.link)) throw new Error('NOT_FOUND');
    const r = await fetch(dl.link, { redirect: 'follow', signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error('HTTP_' + r.status);
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length || buf.length > 5e6) throw new Error('NOT_FOUND');
    const out = subPath(file, c.lang);
    fs.writeFileSync(out, buf);
    subMeta[out] = { src: 'online', lang: c.lang, release: clip(c.release, 160), exact: !!c.exact, hi: !!c.hi };
    saveMeta();
    return out;
  }
  const osErr = err => (['BAD_KEY', 'LIMIT', 'NOT_FOUND'].includes(err.message) ? err.message : 'NET');
  const relOf = out => path.relative(dir, out).split(path.sep).join('/');
  ipcMain.handle('wl:os:search', async (e, rel, q) => {
    guard(e);
    const file = libFile(rel, x => !!MEDIA[x]), key = osKey();
    if (!file || !q || typeof q !== 'object') return { error: 'BAD' };
    if (!key) return { error: 'NO_KEY' };
    try { return { list: (await osSearch(file, key, q)).slice(0, 60), quota: osQuota }; }
    catch (err) { return { error: osErr(err) }; }
  });
  ipcMain.handle('wl:os:get', async (e, rel, c) => {
    guard(e);
    const file = libFile(rel, x => !!MEDIA[x]), key = osKey();
    if (!file || !c || !int(c.id) || !OS_LANGS.includes(c.lang)) return { error: 'BAD' };
    if (!key) return { error: 'NO_KEY' };
    try { const out = await osGet(file, key, c); return { ok: true, name: relOf(out), subs: await sidecars(file), quota: osQuota }; }
    catch (err) { return { error: osErr(err), quota: osQuota }; }
  });
  // تلقائي: الأحسن (لو الملف مالوش ترجمة، أو "عربي/إنجليزي أونلاين" من القايمة)
  ipcMain.handle('wl:dl:subsOnline', async (e, rel, q) => {
    guard(e);
    const file = libFile(rel, x => !!MEDIA[x]), key = osKey();
    if (!file || !q || typeof q !== 'object') return { error: 'BAD' };
    if (!key) return { error: 'NO_KEY' };
    try {
      const list = await osSearch(file, key, { ...q, langs: OS_LANGS.includes(q.lang) ? [q.lang] : null });
      if (!list.length) return { error: 'NOT_FOUND' };
      const out = await osGet(file, key, list[0]);
      return { ok: true, name: relOf(out), exact: list[0].exact, subs: await sidecars(file), quota: osQuota };
    } catch (err) { return { error: osErr(err), quota: osQuota }; }
  });
  // فحص المفتاح قبل ما يتحفظ (زي TMDB/OMDb)
  ipcMain.handle('wl:os:check', async (e, key) => {
    guard(e);
    if (typeof key !== 'string' || !/^[A-Za-z0-9]{16,64}$/.test(key)) return { ok: false, error: 'BAD_KEY' };
    try { await osFetch(`${osBase}/infos/formats`, { headers: osHeaders(key) }); return { ok: true }; }
    catch (err) { return { ok: false, error: err.message === 'BAD_KEY' ? 'BAD_KEY' : 'NET' }; }
  });
  // الحساب: الباسورد بيروح لـ OpenSubtitles بس، وبيتحفظ متشفّر — عمره ما بيرجع للواجهة
  ipcMain.handle('wl:os:login', async (e, user, pass) => {
    guard(e);
    const key = osKey();
    if (!key) return { error: 'NO_KEY' };
    if (typeof user !== 'string' || typeof pass !== 'string' || !user.trim() || !pass || user.length > 100 || pass.length > 200) return { error: 'BAD_LOGIN' };
    if (!safeStorage.isEncryptionAvailable()) return { error: 'NO_CRYPTO' };
    try { await osLogin(key, user.trim(), pass); }
    catch (err) { return { error: err.message === 'BAD_KEY' || err.message === 'BAD_LOGIN' ? 'BAD_LOGIN' : osErr(err) }; }
    fs.writeFileSync(OS_FILE, JSON.stringify({ user: user.trim(), pass: safeStorage.encryptString(pass).toString('base64') }));
    return { ok: true, user: user.trim(), quota: osQuota };
  });
  ipcMain.handle('wl:os:logout', e => {
    guard(e);
    try { fs.rmSync(OS_FILE, { force: true }); } catch (err) {}
    osToken = null; osQuota = null;
    return true;
  });
  ipcMain.handle('wl:os:status', async e => {
    guard(e);
    const c = osCreds(), key = osKey();
    // داخل بحسابه: الحد الفعلي من OpenSubtitles (فاضل كام النهارده)
    if (c && key) {
      try {
        const j = await (await osFetch(`${osBase}/infos/user`, { headers: await osAuth(key) })).json();
        const d = j && j.data || {};
        if (Number.isFinite(Number(d.remaining_downloads))) osQuota = { allowed: Number(d.allowed_downloads) || null, remaining: Number(d.remaining_downloads), reset: (osQuota && osQuota.reset) || null };
      } catch (err) {}
    }
    return { key: !!key, user: c ? c.user : null, quota: osQuota };
  });

  ipcMain.handle('wl:dl:reveal', (e, name) => {
    guard(e);
    const file = libFile(name, x => !!MEDIA[x]);
    if (!file) return false;
    shell.showItemInFolder(file);
    return true;
  });
  ipcMain.handle('wl:dl:pickDir', async e => {
    guard(e);
    const r = await dialog.showOpenDialog(getWindow(), { title: 'فولدر التنزيلات', defaultPath: dir, properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return dir;
    dir = r.filePaths[0];
    fs.writeFileSync(settingsPath, JSON.stringify({ dir }));
    return dir;
  });

  return { beforeQuit };
}

module.exports = { initDownloads, safeName };
