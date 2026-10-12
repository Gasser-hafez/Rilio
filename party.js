// Watch Party — جزء الـ main process: الاتصال بسيرفر الأوضة، ومراجعة كل رسالة، والتوصيل بين
// الواجهة (app.js) وفريمات البلاير (preload.js) اللي بتتحكم في الـ <video> فعلاً
const { ipcMain } = require('electron');
const { randomBytes } = require('crypto');
// protocol.mjs مكتوب ESM عشان يتشارك مع السيرفر — Node 22+ بيدعم require(esm)
const { isRoomCode, newRoomCode, validMedia, validState, parseServerMessage } = require('./party-server/public/protocol.mjs');

const PING_EVERY_MS = 25 * 1000;
const RECONNECT_MAX_MS = 15 * 1000;
const LOCAL_THROTTLE_MS = 300;
const SEEK_TOLERANCE_S = 1.5;
const MIN_MAIN_VIDEO_S = 60; // أقل من كده غالباً إعلان

const sameMedia = (a, b) => !!a && !!b && a.tmdbId === b.tmdbId && a.type === b.type && a.srv === b.srv
  && (a.season || 0) === (b.season || 0) && (a.episode || 0) === (b.episode || 0);

function initParty({ getWindow, serverUrl, fromApp }) {
  let ws = null, code = null, status = 'idle', peers = 0, lastSeq = -1;
  let media = null;   // الفيلم/الحلقة الحالية في الأوضة
  let desired = null; // {paused, pos, at} — at = وقت الاستلام محلياً
  let roomFresh = false; // الأوضة لسه على حالة البداية (واقفة عند 0 ومحدش ضغط)
  let videoFrame = null, videoDuration = 0; // videoFrame = 'processId:routingId'
  const frameKey = f => `${f.processId}:${f.routingId}`;
  let retry = 0, retryTimer = null, pingTimer = null;
  let pendingLocal = null, localTimer = null, lastLocalSent = 0;

  const win = () => getWindow();
  const toApp = (ch, payload) => { const w = win(); if (w && !w.isDestroyed()) w.webContents.send(ch, payload); };
  // لينك صفحة الويب لصحابك اللي معندهمش البرنامج — نفس سيرفر الأوضة بـ https
  const webBase = serverUrl ? serverUrl.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:') : '';
  const webUrl = () => (code && webBase ? `${webBase}/join/${code.slice(0, 4)}-${code.slice(4)}` : null);
  const pushStatus = (error) => toApp('wl:party:status', { status, code, peers, media, webUrl: webUrl(), error: error || null });

  // الوقت المتوقع دلوقتي للفيديو حسب آخر حالة من الأوضة
  const expectedPos = () => !desired ? 0 : desired.paused ? desired.pos : desired.pos + (Date.now() - desired.at) / 1000;

  function sendToFrames() {
    const w = win();
    if (!w || w.isDestroyed() || !desired) return;
    const cmd = { paused: desired.paused, pos: expectedPos(), sentAt: Date.now() };
    for (const f of w.webContents.mainFrame.framesInSubtree) {
      if (f === w.webContents.mainFrame) continue;
      try { f.send('wl:party:cmd', cmd); } catch (e) { /* فريم اتشال */ }
    }
  }

  function send(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  function onServerMessage(raw) {
    const m = parseServerMessage(typeof raw === 'string' ? raw : '');
    if (!m) return; // السيرفر مش موثوق هو كمان — أي حاجة مش مطابقة للبروتوكول بتتجاهل
    switch (m.t) {
      case 'sync':
        lastSeq = m.seq; peers = m.peers; media = m.media;
        desired = m.state ? { paused: m.state.paused, pos: m.state.pos + (m.state.paused ? 0 : m.state.age / 1000), at: Date.now() } : null;
        roomFresh = !!m.state && m.state.paused && m.state.pos === 0;
        status = 'connected'; retry = 0;
        pushStatus();
        if (media) toApp('wl:party:media', media);
        sendToFrames();
        break;
      case 'media': {
        if (m.seq <= lastSeq) return;
        lastSeq = m.seq;
        const changed = !sameMedia(media, m.media);
        media = m.media;
        desired = { paused: true, pos: 0, at: Date.now() };
        roomFresh = true;
        if (changed) { videoFrame = null; videoDuration = 0; }
        pushStatus();
        if (changed) toApp('wl:party:media', media);
        break;
      }
      case 'state':
        if (m.seq <= lastSeq) return;
        lastSeq = m.seq;
        desired = { paused: m.paused, pos: m.pos + (m.paused ? 0 : m.age / 1000), at: Date.now() };
        roomFresh = false;
        sendToFrames();
        break;
      case 'peers':
        peers = m.n; pushStatus();
        break;
      case 'error':
        if (m.code === 'room_full') { leave(); pushStatus('room_full'); }
        break;
    }
  }

  function connect() {
    clearTimeout(retryTimer);
    status = retry ? 'reconnecting' : 'connecting';
    pushStatus();
    let sock;
    try { sock = new WebSocket(`${serverUrl}/room/${code}`); } catch (e) { scheduleRetry(); return; }
    ws = sock;
    sock.onmessage = e => { if (ws === sock) onServerMessage(e.data); };
    sock.onclose = () => { if (ws === sock) { ws = null; clearInterval(pingTimer); if (code) scheduleRetry(); } };
    sock.onerror = () => { /* onclose هيتنادى بعدها */ };
    sock.onopen = () => {
      clearInterval(pingTimer);
      pingTimer = setInterval(() => send({ t: 'ping' }), PING_EVERY_MS);
    };
  }

  function scheduleRetry() {
    if (!code) return;
    status = 'reconnecting';
    pushStatus();
    const delay = Math.min(RECONNECT_MAX_MS, 1000 * 2 ** retry++);
    retryTimer = setTimeout(connect, delay);
  }

  function start(c) {
    leave();
    code = c; lastSeq = -1; media = null; desired = null; retry = 0;
    connect();
    return code;
  }

  function leave() {
    const had = !!code;
    code = null; status = 'idle'; peers = 0; media = null; desired = null; lastSeq = -1;
    videoFrame = null; videoDuration = 0;
    clearTimeout(retryTimer); clearInterval(pingTimer); clearTimeout(localTimer);
    pendingLocal = null;
    if (ws) { const s = ws; ws = null; try { s.close(1000, 'leave'); } catch (e) {} }
    if (had) pushStatus();
  }

  // أحداث المستخدم من الفيديو (تشغيل/إيقاف/تقديم) — throttle عشان التقديم بيطلع أحداث كتير ورا بعض
  function onLocal(state) {
    if (status !== 'connected' || !media) return;
    // لو مطابقة للي الأوضة عايزاه، دي نتيجة أمر إحنا طبقناه مش ضغطة من المستخدم
    if (desired && desired.paused === state.paused && Math.abs(expectedPos() - state.pos) < SEEK_TOLERANCE_S) return;
    pendingLocal = state;
    const wait = Math.max(0, LOCAL_THROTTLE_MS - (Date.now() - lastLocalSent));
    clearTimeout(localTimer);
    localTimer = setTimeout(() => {
      if (!pendingLocal) return;
      lastLocalSent = Date.now();
      send({ t: 'state', paused: pendingLocal.paused, pos: pendingLocal.pos });
      pendingLocal = null;
    }, wait);
  }

  /* ---------- IPC من الواجهة ---------- */
  ipcMain.handle('wl:party:create', e => {
    if (!fromApp(e)) throw new Error('forbidden');
    if (!serverUrl) throw new Error('no_server');
    return start(newRoomCode(n => randomBytes(n)));
  });
  ipcMain.handle('wl:party:join', (e, c) => {
    if (!fromApp(e)) throw new Error('forbidden');
    if (!serverUrl) throw new Error('no_server');
    const norm = typeof c === 'string' ? c.toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
    if (!isRoomCode(norm)) throw new Error('bad_code');
    return start(norm);
  });
  ipcMain.handle('wl:party:leave', e => { if (!fromApp(e)) throw new Error('forbidden'); leave(); return true; });
  ipcMain.handle('wl:party:setMedia', (e, m) => {
    if (!fromApp(e)) throw new Error('forbidden');
    const v = validMedia(m);
    if (!v) throw new Error('bad_media');
    // نفس الحلقة اللي شغالة؟ متبعتش — وإلا الأوضة كلها ترجع للصفر
    if (status !== 'connected' || sameMedia(media, v)) return false;
    send({ t: 'media', media: v });
    return true;
  });
  ipcMain.handle('wl:party:status', e => {
    if (!fromApp(e)) throw new Error('forbidden');
    return { status, code, peers, media, webUrl: webUrl(), error: null, enabled: !!serverUrl };
  });

  /* ---------- IPC من فريمات البلاير ---------- */
  // بنقبل بس من فريمات جوه نافذة البرنامج الرئيسية (مش نوافذ مواقع المشاهدة)
  const fromPlayerFrame = e => {
    const w = win();
    return !!w && e.sender === w.webContents && !!e.senderFrame && e.senderFrame !== w.webContents.mainFrame;
  };
  ipcMain.on('wl:party:ready', (e, info) => {
    if (!fromPlayerFrame(e)) return;
    const d = info && Number.isFinite(info.duration) ? info.duration : 0;
    if (d < MIN_MAIN_VIDEO_S) return;
    // الفيديو الأساسي = الأطول (إعلانات الفيديو قصيرة)
    if (!videoFrame || d >= videoDuration) { videoFrame = frameKey(e.senderFrame); videoDuration = d; }
    // أول ضغطة play في الأوضة بتعمل الـ <video> نفسه، فالحدث بيحصل قبل ما نمسكه —
    // لو الأوضة لسه في البداية والفيديو شغال، ده أول تشغيل: يتبعت للكل بدل ما نوقّفه
    const st = validState(info);
    if (roomFresh && st && !st.paused && status === 'connected' && media) {
      roomFresh = false;
      send({ t: 'state', paused: false, pos: st.pos });
      return;
    }
    sendToFrames();
  });
  ipcMain.on('wl:party:local', (e, s) => {
    if (!fromPlayerFrame(e) || frameKey(e.senderFrame) !== videoFrame) return;
    const st = validState(s);
    if (st) onLocal(st);
  });

  return { leave, active: () => !!code };
}

module.exports = { initParty, sameMedia };
