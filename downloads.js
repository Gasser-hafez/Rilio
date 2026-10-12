// مدير التنزيلات + المكتبة المحلية — جزء الـ main process
// بيمسك بس التنزيلات اللي بتبدأ من نوافذ المواقع (اللي المستخدم ضايفها). تنزيلات الواجهة نفسها (النسخة الاحتياطية) زي ما هي.
// الفولدر متخزن في ملف خاص بـ main مش في storage.json: نسخة احتياطية أو ملف إعدادات متلغّم ميقدرش يوجّه التنزيلات لأي فولدر
const { ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { randomBytes } = require('crypto');
const { Readable } = require('stream');

// اللي بيتشغّل جوه البرنامج (Chromium بيشغّله)
const MEDIA = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav' };
// اللي مسموح يتنزل: ميديا + ترجمة + أرشيف. أي حاجة تانية (exe, msi, bat, scr, lnk, js...) بتتلغي — المواقع دي مليانة برامج ضارة
const ALLOWED = new Set([...Object.keys(MEDIA), '.avi', '.ts', '.srt', '.vtt', '.ass', '.ssa', '.sub', '.zip', '.rar', '.7z']);
const extOf = n => path.extname(n).toLowerCase();

// اسم ملف آمن: من غير مسارات ولا حروف ممنوعة في ويندوز ولا أسماء محجوزة (CON, NUL...)
function safeName(n) {
  let s = path.basename(String(n || '')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^[.\s]+|[.\s]+$/g, '');
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(s)) s = '_' + s;
  if (s.length > 150) s = s.slice(0, 140) + extOf(s).slice(0, 10);
  return s || 'download';
}

function initDownloads({ session, protocol, getWindow, fromApp, isSiteWindow, settingsPath, defaultDir }) {
  const token = randomBytes(16).toString('hex'); // لينكات المكتبة: إعلان في iframe مايقدرش يخمّنها
  const dls = new Map(); // id → { id, name, file, item, state }
  let seq = 0, pushTimer = null;

  let dir = defaultDir;
  try { const s = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); if (typeof s.dir === 'string' && path.isAbsolute(s.dir)) dir = s.dir; } catch (e) {}

  const toApp = (ch, p) => { const w = getWindow(); if (w && !w.isDestroyed()) w.webContents.send(ch, p); };
  const view = d => ({
    id: d.id, name: d.name, received: d.item.getReceivedBytes(), total: d.item.getTotalBytes(),
    state: d.state === 'progressing' && d.item.isPaused() ? 'paused' : d.state,
  });
  const list = () => [...dls.values()].reverse().map(view);
  const push = () => { if (!pushTimer) pushTimer = setTimeout(() => { pushTimer = null; toApp('wl:dl:list', list()); }, 300); };

  function uniquePath(name) {
    const taken = p => fs.existsSync(p) || [...dls.values()].some(d => d.file === p);
    const ext = extOf(name), base = name.slice(0, name.length - ext.length);
    let p = path.join(dir, name);
    for (let i = 1; taken(p); i++) p = path.join(dir, `${base} (${i})${ext}`);
    return p;
  }

  session.on('will-download', (e, item, wc) => {
    if (!wc || !isSiteWindow(wc)) return; // تنزيلات الواجهة: حفظ ويندوز العادي
    const name = safeName(item.getFilename());
    // نافذة فاضية اتفتحت للتنزيل بس — تتقفل
    const closeBlank = () => { if (!wc.isDestroyed() && /^(about:blank)?$/.test(wc.getURL())) wc.close(); };
    if (!ALLOWED.has(extOf(name))) {
      e.preventDefault();
      toApp('wl:dl:event', { kind: 'blocked', name });
      closeBlank();
      return;
    }
    try { fs.mkdirSync(dir, { recursive: true }); } catch (err) {}
    const file = uniquePath(name);
    item.setSavePath(file);
    const d = { id: ++seq, name: path.basename(file), file, item, state: 'progressing' };
    dls.set(d.id, d);
    item.on('updated', (ev, st) => { d.state = st; push(); });
    item.once('done', (ev, st) => {
      d.state = st; push();
      if (st === 'completed') toApp('wl:dl:event', { kind: 'done', name: d.name });
    });
    toApp('wl:dl:event', { kind: 'started', name: d.name });
    push();
    closeBlank();
  });

  // المكتبة: ملفات الميديا في فولدر التنزيلات (مستوى واحد)
  async function library() {
    let names = [];
    try { names = await fs.promises.readdir(dir); } catch (e) { return []; }
    const out = [];
    for (const name of names) {
      if (!MEDIA[extOf(name)]) continue;
      try {
        const st = await fs.promises.stat(path.join(dir, name));
        if (st.isFile()) out.push({ name, size: st.size, mtime: st.mtimeMs, url: `wlmedia://lib/${token}/${encodeURIComponent(name)}` });
      } catch (e) {}
    }
    return out.sort((a, b) => b.mtime - a.mtime);
  }

  // تشغيل ملفات المكتبة في <video>: بالتوكن + اسم ملف بس (مفيش مسارات) + Range عشان التقديم
  protocol.handle('wlmedia', async req => {
    const notFound = () => new Response('Not found', { status: 404 });
    const u = new URL(req.url);
    const [tok, enc, extra] = u.pathname.slice(1).split('/');
    let name = '';
    try { name = decodeURIComponent(enc || ''); } catch (e) { return notFound(); }
    if (u.host !== 'lib' || tok !== token || extra !== undefined || !name || name !== path.basename(name) || !MEDIA[extOf(name)]) return notFound();
    const file = path.join(dir, name);
    let st;
    try { st = await fs.promises.stat(file); } catch (e) { return notFound(); }
    if (!st.isFile()) return notFound();
    const headers = { 'Content-Type': MEDIA[extOf(name)], 'Accept-Ranges': 'bytes' };
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
    if (act === 'pause' && d.state === 'progressing' && !d.item.isPaused()) d.item.pause();
    else if (act === 'resume' && (d.item.isPaused() || d.state === 'interrupted') && d.item.canResume()) d.item.resume();
    else if (act === 'cancel' && d.state === 'progressing') d.item.cancel();
    else if (act === 'show' && d.state === 'completed') shell.showItemInFolder(d.file);
    else return false;
    push();
    return true;
  });
  ipcMain.handle('wl:dl:reveal', (e, name) => {
    guard(e);
    if (typeof name !== 'string' || name !== path.basename(name) || !MEDIA[extOf(name)]) return false;
    shell.showItemInFolder(path.join(dir, name));
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
}

module.exports = { initDownloads, safeName };
