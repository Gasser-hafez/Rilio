// صفحة الويب للضيف: بتدخل الأوضة، تفتح نفس الفيلم/الحلقة على نفس السيرفر، وتبعت ضغطات الضيف للأوضة
import { isRoomCode, parseServerMessage } from './protocol.mjs';
import { embedUrl, parsePlayerEvent, createGuestSync, SERVER_ORIGINS, SYNC_CAPABLE, fmtTime } from './guest-logic.mjs';

const $ = id => document.getElementById(id);
const PING_EVERY_MS = 25000;
const RECONNECT_MAX_MS = 15000;

const code = decodeURIComponent(location.pathname.split('/').pop() || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const sync = createGuestSync();
let ws = null, retry = 0, pingTimer = null, lastSeq = -1, media = null, srv = 0, leaveGuard = false;

function setStatus(t) { $('status').textContent = t; }

// اسم الفيلم من الأوضة بيتعرض كـ textContent — مش HTML
function showMedia(m) {
  const url = embedUrl(m);
  if (!url) return;
  media = m; srv = m.srv;
  sync.resetPlayer();
  $('title').textContent = (m.title || 'Watch Party') + (m.type === 'tv' ? ` — S${String(m.season).padStart(2, '0')}E${String(m.episode).padStart(2, '0')}` : '');
  $('player').src = url;
  $('playerBox').hidden = false;
  $('note').hidden = SYNC_CAPABLE[srv];
  $('note').textContent = 'السيرفر ده مش بيبلّغنا لما توقّف أو تشغّل، فصحابك مش هيتحركوا معاك — اطلب منهم يختاروا سيرفر 1 أو 4 من البرنامج.';
  setStatus('دوس play في البلاير — ولو صحابك شغالين، هتلاقي فوق هما واصلين لفين');
  // لو إعلان حاول ينقل الصفحة كلها لموقع تاني، المتصفح هيسأل الأول
  if (!leaveGuard) { leaveGuard = true; addEventListener('beforeunload', e => { e.preventDefault(); e.returnValue = ''; }); }
}

function renderHint() {
  const h = sync.hint(Date.now());
  const el = $('hint');
  if (!h || !media) { el.hidden = true; return; }
  el.hidden = false;
  el.className = 'hint';
  const t = `<span class="t">${fmtTime(h.pos)}</span>`; // أرقام بس من fmtTime
  el.innerHTML = h.kind === 'pause' ? `⏸ صحابك وقّفوا عند ${t} — دوس pause`
    : h.kind === 'play' ? `▶ صحابك شغالين وواصلين ${t} — دوس play وقدّم لحد هناك`
      : `⏩ صحابك عند ${t} — قدّم أو رجّع لحد هناك`;
}
setInterval(renderHint, 1000);

function send(msg) { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); }

function onServer(raw) {
  const m = parseServerMessage(typeof raw === 'string' ? raw : '');
  if (!m) return; // أي حاجة مش مطابقة للبروتوكول بتتجاهل
  const now = Date.now();
  if (m.t === 'sync') {
    lastSeq = m.seq; retry = 0;
    $('peers').hidden = false; $('peers').textContent = `👥 ${m.peers}`;
    if (m.media) showMedia(m.media); else { $('title').textContent = 'إنت في الأوضة'; setStatus('مستنيين صاحبك يفتح فيلم أو حلقة من البرنامج'); }
    sync.onRoom(m.state ? { paused: m.state.paused, pos: m.state.pos + (m.state.paused ? 0 : m.state.age / 1000) } : null, now);
  } else if (m.t === 'media') {
    if (m.seq <= lastSeq) return; lastSeq = m.seq;
    showMedia(m.media);
    sync.onRoom({ paused: true, pos: 0 }, now);
  } else if (m.t === 'state') {
    if (m.seq <= lastSeq) return; lastSeq = m.seq;
    sync.onRoom({ paused: m.paused, pos: m.pos + (m.paused ? 0 : m.age / 1000) }, now);
  } else if (m.t === 'peers') {
    $('peers').textContent = `👥 ${m.n}`;
  } else if (m.t === 'error' && m.code === 'room_full') {
    setStatus('الأوضة مليانة (8 أشخاص بالكتير)');
    ws.onclose = null; // متحاولش تدخل تاني
    ws.close();
  }
  renderHint();
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const sock = new WebSocket(`${proto}//${location.host}/room/${code}`);
  ws = sock;
  sock.onmessage = e => onServer(e.data);
  sock.onopen = () => { clearInterval(pingTimer); pingTimer = setInterval(() => send({ t: 'ping' }), PING_EVERY_MS); };
  sock.onclose = () => {
    clearInterval(pingTimer);
    setStatus('النت فصل — بحاول أرجع تاني...');
    setTimeout(connect, Math.min(RECONNECT_MAX_MS, 1000 * 2 ** retry++));
  };
}

// أحداث البلاير: بنقبل بس من الـ iframe بتاعنا ومن دومين سيرفر الأوضة
addEventListener('message', e => {
  if (!media || e.source !== $('player').contentWindow || e.origin !== SERVER_ORIGINS[srv]) return;
  const ev = parsePlayerEvent(srv, e.data);
  if (!ev) return;
  const { send: st } = sync.onPlayer(ev, Date.now());
  if (st) send({ t: 'state', paused: st.paused, pos: st.pos });
  renderHint();
});

if (!isRoomCode(code)) {
  $('title').textContent = 'اللينك ده مش صحيح';
  setStatus('اطلب من صاحبك يبعتلك لينك الأوضة تاني من البرنامج');
} else {
  setStatus('بتتصل بالأوضة...');
  connect();
}
