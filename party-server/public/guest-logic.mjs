// منطق صفحة الويب (ضيف من غير البرنامج) — pure، بيتختبر في test/guest-logic.test.mjs
// المشغلات مبتقبلش أوامر من برا ومبتشتغلش جوه sandbox: الضيف بيتحكم في الأوضة (أحداث البلاير)،
// والأوضة بتقول للضيف يعمل إيه (شريط "صاحبك وقّف عند ...") — مش بتتحكم في البلاير بتاعه
import { validMedia } from './protocol.mjs';

// نفس PLAYER_SERVERS في app.js بالترتيب (test/e2e.mjs بيتأكد إنهم متطابقين)
export const SERVERS = [
  'https://vsembed.ru/embed/{type}?tmdb={tmdbID}&season={season}&episode={episode}',
  'https://vidsrc.cc/v2/embed/{type}/{tmdbID}/{season}/{episode}',
  'https://player.embed-api.stream/?id={tmdbID}&s={season}&e={episode}',
  'https://vidlink.pro/{type}/{tmdbID}/{season}/{episode}',
];
export const SERVER_ORIGINS = SERVERS.map(t => new URL(t.replace(/\{[^}]+\}/g, 'x')).origin);
// المشغلات اللي بتبعت حالتها للصفحة (اتجربت: vsembed كل ~5 ثواني، vidlink كل ثانية + play/pause)
export const SYNC_CAPABLE = [true, false, false, true];

export const SYNC_TOLERANCE_S = 10; // فرق أقل من كده = "مع بعض" (vsembed بيبلّغ كل 5 ثواني)
export const SEEK_JUMP_S = 6;       // قفزة أكبر من كده عن المتوقع = الضيف قدّم/رجّع

const srvOf = m => (Number.isInteger(m.srv) && m.srv >= 0 && m.srv < SERVERS.length ? m.srv : 0);

// نفس منطق fillUrl في app.js: للأفلام بنشيل أجزاء الموسم/الحلقة. أرقام بس — مفيش أي نص من برا في اللينك
export function embedUrl(media) {
  const m = validMedia(media);
  if (!m) return null;
  let url = SERVERS[srvOf(m)];
  if (m.type !== 'tv') {
    url = url.replace(/\/\{season\}\/\{episode\}/g, '')
      .replace(/[?&][A-Za-z_]*=\{season\}/g, '')
      .replace(/[?&][A-Za-z_]*=\{episode\}/g, '')
      .replace(/\?&/, '?').replace(/[?&]$/, '');
  }
  url = url.replace(/\{tmdbID\}/g, String(m.tmdbId)).replace(/\{type\}/g, m.type)
    .replace(/\{season\}/g, String(m.season || 1)).replace(/\{episode\}/g, String(m.episode || 1));
  return url + (url.includes('?') ? '&' : '?') + 'ds_lang=ar&sub_lang=ar';
}

const num = v => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1e6 ? v : null);

// رسالة من البلاير → { paused: true|false|null(مش معروف), pos } أو null
export function parsePlayerEvent(srv, data) {
  if (!data || typeof data !== 'object' || data.type !== 'PLAYER_EVENT' || !data.data || typeof data.data !== 'object') return null;
  const d = data.data;
  if (srv === 0) { // vsembed: { player_status, player_progress }
    const pos = num(d.player_progress);
    if (pos == null) return null;
    const s = d.player_status;
    return { paused: s === 'playing' ? false : s === 'paused' || s === 'ended' ? true : null, pos };
  }
  if (srv === 3) { // vidlink: { event, currentTime }
    const pos = num(d.currentTime);
    if (pos == null) return null;
    const e = d.event;
    return { paused: e === 'play' || e === 'playing' ? false : e === 'pause' || e === 'ended' ? true : null, pos };
  }
  return null;
}

// قرارات المزامنة. room/player = { paused, pos, at } — at بالـ ms (Date.now)
export function createGuestSync() {
  let room = null;
  let player = null;
  const expected = (s, now) => (!s ? 0 : s.paused ? s.pos : s.pos + (now - s.at) / 1000);

  return {
    // حالة جديدة من الأوضة (حد تاني ضغط، أو رجعتلنا ضغطتنا)
    onRoom(st, now) { room = st ? { paused: st.paused, pos: st.pos, at: now } : null; },
    resetPlayer() { player = null; },

    // حدث من البلاير بتاع الضيف → { send } لو ده فعل من الضيف لازم الأوضة تعرفه
    onPlayer(ev, now) {
      const prev = player;
      const paused = ev.paused == null ? (prev ? prev.paused : true) : ev.paused;
      player = { paused, pos: ev.pos, at: now };
      if (!room) return {};
      const roomPos = expected(room, now);
      const wasPaused = prev ? prev.paused : true;

      // بدأ يشغّل: لو الأوضة واقفة يبقى هو اللي شغّل للكل. لو الأوضة شغالة أصلاً، هو بيلحقها بس
      if (!paused && wasPaused) return room.paused ? { send: { paused: false, pos: ev.pos } } : {};

      // وقّف: الكل يقف — عند مكانه لو كان معاهم، وإلا عند مكان الأوضة (منرجّعش الكل لمكانه هو)
      if (paused && !wasPaused) {
        if (room.paused) return {};
        const inSync = Math.abs(ev.pos - roomPos) < SYNC_TOLERANCE_S;
        return { send: { paused: true, pos: inSync ? ev.pos : roomPos } };
      }

      // قدّم/رجّع: قفزة عن المتوقع وهو كان مع الأوضة قبلها → الكل يروح معاه
      if (prev) {
        const prevExpected = expected(prev, now);
        const jumped = Math.abs(ev.pos - prevExpected) > SEEK_JUMP_S;
        const wasInSync = Math.abs(prevExpected - roomPos) < SYNC_TOLERANCE_S;
        if (jumped && wasInSync) return { send: { paused, pos: ev.pos } };
      }
      return {};
    },

    // الشريط اللي بيقول للضيف يعمل إيه عشان يرجع مع الأوضة
    hint(now) {
      if (!room) return null;
      const roomPos = expected(room, now);
      if (!player) return room.paused ? null : { kind: 'play', pos: roomPos };
      if (room.paused && !player.paused) return { kind: 'pause', pos: room.pos };
      if (!room.paused && player.paused) return { kind: 'play', pos: roomPos };
      if (Math.abs(expected(player, now) - roomPos) > SYNC_TOLERANCE_S) return { kind: 'seek', pos: roomPos };
      return null;
    },
  };
}

export const fmtTime = s => {
  const t = Math.max(0, Math.floor(s || 0)), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(sec).padStart(2, '0');
};
