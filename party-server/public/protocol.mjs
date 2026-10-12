// بروتوكول الـ Watch Party — كود مشترك بين السيرفر (Cloudflare) والبرنامج (main process)
// كل الدوال هنا pure: مفيش شبكة ولا تخزين، فبتتختبر لوحدها في test/protocol.test.mjs

export const MAX_MESSAGE_BYTES = 1024;
export const MAX_PEERS = 8;
export const RATE_WINDOW_MS = 5000;
export const RATE_MAX_MESSAGES = 30;
export const ROOM_IDLE_TTL_MS = 6 * 60 * 60 * 1000;

// 8 حروف من غير الحروف اللي بتتلخبط (0/O و1/I) — 32^8 ≈ 10^12 احتمال
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_RE = /^[A-HJ-NP-Z2-9]{8}$/;

export const isRoomCode = code => typeof code === 'string' && ROOM_RE.test(code);

// randomBytes: دالة بترجع Uint8Array عشوائي آمن (crypto.getRandomValues في المتصفح/الـ Worker)
export function newRoomCode(randomBytes) {
  const b = randomBytes(8);
  let s = '';
  for (let i = 0; i < 8; i++) s += ROOM_ALPHABET[b[i] % 32]; // 256 % 32 = 0 → مفيش bias
  return s;
}

const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const isNum = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

// الفيلم/الحلقة: أرقام بس + رقم سيرفر من الليستة الثابتة في البرنامج — مفيش لينكات أبداً
export function validMedia(m) {
  if (!m || typeof m !== 'object') return null;
  if (!isInt(m.tmdbId, 1, 1e9)) return null;
  if (m.type !== 'movie' && m.type !== 'tv') return null;
  if (!isInt(m.srv, 0, 31)) return null;
  const out = { tmdbId: m.tmdbId, type: m.type, srv: m.srv, title: typeof m.title === 'string' ? m.title.slice(0, 120) : '' };
  if (m.type === 'tv') {
    if (!isInt(m.season, 1, 1000) || !isInt(m.episode, 1, 10000)) return null;
    out.season = m.season;
    out.episode = m.episode;
  }
  return out;
}

export function validState(s) {
  if (!s || typeof s !== 'object') return null;
  if (typeof s.paused !== 'boolean' || !isNum(s.pos, 0, 1e6)) return null;
  return { paused: s.paused, pos: s.pos };
}

// رسالة جاية من البرنامج للسيرفر
export function parseClientMessage(raw) {
  if (typeof raw !== 'string') return { ok: false, code: 'bad_type' };
  if (raw.length > MAX_MESSAGE_BYTES) return { ok: false, code: 'too_big' };
  let m;
  try { m = JSON.parse(raw); } catch (e) { return { ok: false, code: 'bad_json' }; }
  if (!m || typeof m !== 'object') return { ok: false, code: 'bad_json' };
  if (m.t === 'ping') return { ok: true, msg: { t: 'ping' } };
  if (m.t === 'media') {
    const media = validMedia(m.media);
    return media ? { ok: true, msg: { t: 'media', media } } : { ok: false, code: 'bad_media' };
  }
  if (m.t === 'state') {
    const st = validState(m);
    return st ? { ok: true, msg: { t: 'state', ...st } } : { ok: false, code: 'bad_state' };
  }
  return { ok: false, code: 'unknown_type' };
}

export const emptyRoom = () => ({ media: null, state: null, seq: 0, touched: 0 });

// بيطبّق رسالة على حالة الأوضة ويرجّع الحالة الجديدة + اللي يتبعت للكل (بما فيهم اللي بعت —
// كده الكل بيوصل لنفس الترتيب حتى لو اتنين ضغطوا في نفس اللحظة)
export function applyMessage(room, msg, now) {
  if (msg.t === 'media') {
    const seq = room.seq + 1;
    // فيلم/حلقة جديدة: الحالة بتبدأ من الأول وواقفة
    const state = { paused: true, pos: 0, ts: now };
    return { room: { media: msg.media, state, seq, touched: now }, broadcast: { t: 'media', media: msg.media, seq } };
  }
  if (msg.t === 'state') {
    if (!room.media) return { room, broadcast: null };
    const seq = room.seq + 1;
    const state = { paused: msg.paused, pos: msg.pos, ts: now };
    return { room: { ...room, state, seq, touched: now }, broadcast: { t: 'state', paused: msg.paused, pos: msg.pos, age: 0, seq } };
  }
  return { room, broadcast: null };
}

// اللي بيدخل الأوضة بياخد الحالة الحالية؛ age = عدّى قد إيه من آخر تحديث (بالسيرفر) —
// البرنامج بيزوّدها على الـ pos لو شغال، فمش محتاجين الساعات تبقى مظبوطة
export function snapshot(room, now, peers) {
  const state = room.state ? { paused: room.state.paused, pos: room.state.pos, age: Math.max(0, now - room.state.ts) } : null;
  return { t: 'sync', media: room.media, state, seq: room.seq, peers };
}

// rate limit لكل اتصال (window ثابت) — rl بيتخزن مع الـ socket
export function rateLimit(rl, now) {
  if (!rl || now - rl.start >= RATE_WINDOW_MS) return { allowed: true, rl: { start: now, n: 1 } };
  const n = rl.n + 1;
  return { allowed: n <= RATE_MAX_MESSAGES, rl: { start: rl.start, n } };
}

// رسالة جاية من السيرفر للبرنامج — البرنامج مبيثقش في السيرفر هو كمان
export function parseServerMessage(raw) {
  if (typeof raw !== 'string' || raw.length > 4096) return null;
  let m;
  try { m = JSON.parse(raw); } catch (e) { return null; }
  if (!m || typeof m !== 'object') return null;
  const seqOk = v => isInt(v, 0, Number.MAX_SAFE_INTEGER);
  switch (m.t) {
    case 'sync': {
      if (!seqOk(m.seq) || !isInt(m.peers, 0, MAX_PEERS)) return null;
      const media = m.media == null ? null : validMedia(m.media);
      if (m.media != null && !media) return null;
      let state = null;
      if (m.state != null) {
        state = validState(m.state);
        if (!state || !isNum(m.state.age, 0, 1e12)) return null;
        state.age = m.state.age;
      }
      return { t: 'sync', media, state, seq: m.seq, peers: m.peers };
    }
    case 'media': {
      const media = validMedia(m.media);
      return media && seqOk(m.seq) ? { t: 'media', media, seq: m.seq } : null;
    }
    case 'state': {
      const st = validState(m);
      return st && seqOk(m.seq) && isNum(m.age, 0, 1e12) ? { t: 'state', ...st, age: m.age, seq: m.seq } : null;
    }
    case 'peers': return isInt(m.n, 0, MAX_PEERS) ? { t: 'peers', n: m.n } : null;
    case 'error': return typeof m.code === 'string' ? { t: 'error', code: m.code.slice(0, 40) } : null;
    case 'pong': return { t: 'pong' };
    default: return null;
  }
}
