// تتبع الحلقات تلقائي: أحداث البلاير → "اتشافت" عند ~90% + مكان الوقوف
// pure (من غير DOM) — app.js بيستخدمه، وtest/progress.test.mjs بيختبره
const WlProgress = (() => {
  const DONE_AT = 0.9;     // 90% = الحلقة اتشافت (التترات مش لازم تخلص)
  const MIN_DUR_S = 300;   // أقل من 5 دقايق = إعلان/تريلر جوه البلاير، مش الحلقة
  const SAVE_EVERY_S = 30; // مكان الوقوف بيتحفظ كل 30 ثانية تفرّج أو عند الإيقاف
  const num = v => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1e6 ? v : null);

  // نفس شكل parsePlayerEvent في party-server/public/guest-logic.mjs + المدة.
  // srv = رقم السيرفر في PLAYER_SERVERS: 0 vsembed، 3 vidlink (الباقيين مبيبعتوش حاجة)
  function parse(srv, data) {
    if (!data || typeof data !== 'object' || data.type !== 'PLAYER_EVENT' || !data.data || typeof data.data !== 'object') return null;
    const d = data.data;
    let pos, dur, paused;
    if (srv === 0) { pos = num(d.player_progress); dur = num(d.player_duration); paused = d.player_status === 'paused' || d.player_status === 'ended'; }
    else if (srv === 3) { pos = num(d.currentTime); dur = num(d.duration); paused = d.event === 'pause' || d.event === 'ended'; }
    else return null;
    return pos == null || dur == null ? null : { pos, dur, paused };
  }

  // sess = { done, savedAt } لحلقة واحدة مفتوحة. بيرجع 'done' مرة واحدة بس للحلقة، أو 'save'، أو null
  function step(sess, ev) {
    if (sess.done || ev.dur < MIN_DUR_S || ev.pos > ev.dur + 5) return null;
    if (ev.pos >= ev.dur * DONE_AT) { sess.done = true; return 'done'; }
    if ((ev.paused && ev.pos !== sess.savedAt) || sess.savedAt == null || Math.abs(ev.pos - sess.savedAt) >= SAVE_EVERY_S) { sess.savedAt = ev.pos; return 'save'; }
    return null;
  }

  return { parse, step, DONE_AT, MIN_DUR_S };
})();
if (typeof module === 'object') module.exports = WlProgress;
