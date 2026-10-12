// تتبع الحلقات تلقائي: أحداث البلاير → "اتشافت" عند ~90% + مكان الوقوف
// pure (من غير DOM) — app.js بيستخدمه، وtest/progress.test.mjs بيختبره
const WlProgress = (() => {
  const DONE_AT = 0.9;     // 90% = الحلقة اتشافت (التترات مش لازم تخلص)
  const MIN_DUR_S = 300;   // أقل من 5 دقايق = إعلان/تريلر جوه البلاير، مش الحلقة
  const SAVE_EVERY_S = 30; // مكان الوقوف بيتحفظ كل 30 ثانية تفرّج أو عند الإيقاف
  const num = v => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1e6 ? v : null);
  // رقم صحيح موجب (البلايرات بتبعته رقم أو نص زي "1396")
  const int = v => { const n = typeof v === 'string' && /^\d{1,8}$/.test(v) ? +v : v; return Number.isInteger(n) && n > 0 && n < 1e8 ? n : null; };

  // PLAYER_EVENT بشكلين (بنعرفهم من الشكل مش من السيرفر — السيرفرات بتعمل redirect لدومينات تانية):
  //  vsembed/vidsrc: { player_status, player_progress, player_duration, player_info:{tmdb,season,episode} }
  //  vidlink:        { event, currentTime, duration, mtmdbId?, season?, episode? }
  // → { pos, dur, paused, tmdb, s, e } — tmdb/s/e = null لو البلاير مبعتهمش
  function parse(data) {
    if (!data || typeof data !== 'object' || data.type !== 'PLAYER_EVENT' || !data.data || typeof data.data !== 'object') return null;
    const d = data.data;
    let pos, dur, paused, info;
    if ('player_progress' in d) {
      pos = num(d.player_progress); dur = num(d.player_duration);
      paused = d.player_status === 'paused' || d.player_status === 'ended';
      const i = d.player_info && typeof d.player_info === 'object' ? d.player_info : {};
      info = { tmdb: i.tmdb, s: i.season, e: i.episode };
    } else if ('currentTime' in d) {
      pos = num(d.currentTime); dur = num(d.duration);
      paused = d.event === 'pause' || d.event === 'ended';
      info = { tmdb: d.mtmdbId ?? d.tmdbId, s: d.season, e: d.episode };
    } else return null;
    if (pos == null || dur == null) return null;
    const s = int(info.s), e = int(info.e);
    return { pos, dur, paused, tmdb: int(info.tmdb), s: s && e ? s : null, e: s && e ? e : null };
  }

  // sess = { done:Set, ep, savedAt } للبلاير المفتوح. ep = "الموسم×الحلقة" اللي بتتعرض (البلاير ممكن يغيّرها من جواه).
  // بيرجع 'done' مرة واحدة بس لكل حلقة، أو 'save'، أو null
  function step(sess, ev, ep) {
    if (sess.ep !== ep) { sess.ep = ep; sess.savedAt = null; }
    if (sess.done.has(ep) || ev.dur < MIN_DUR_S || ev.pos > ev.dur + 5) return null;
    if (ev.pos >= ev.dur * DONE_AT) { sess.done.add(ep); return 'done'; }
    if ((ev.paused && ev.pos !== sess.savedAt) || sess.savedAt == null || Math.abs(ev.pos - sess.savedAt) >= SAVE_EVERY_S) { sess.savedAt = ev.pos; return 'save'; }
    return null;
  }

  // ملف متنزّل → أنهي عنوان من القايمة وأنهي حلقة (لو التنزيل مجاش من صفحة عنوان معروف)
  // "The.Boys.S02E05.1080p.mkv" → { id, s:2, e:5 }. العنوان الأطول اللي اسمه كله جوه اسم الملف هو اللي بيكسب
  const norm = s => ' ' + String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9؀-ۿ]+/g, ' ').trim() + ' ';
  function fileGuess(name, items) {
    const n = norm(String(name).replace(/\.[a-z0-9]{2,4}$/i, ''));
    const m = /\ss(\d{1,2})\s?e(\d{1,3})\s/.exec(n) || /\s(\d{1,2})x(\d{1,3})\s/.exec(n);
    let best = null;
    for (const it of items || []) {
      const t = norm(it.title);
      if (t.trim().length < 3 || !n.includes(t)) continue;
      if (!best || t.length > best.t.length) best = { t, it };
    }
    if (!best) return null;
    const tv = best.it.type === 'tv';
    return { id: best.it.id, s: tv && m ? +m[1] : null, e: tv && m ? +m[2] : null };
  }

  return { parse, step, fileGuess, DONE_AT, MIN_DUR_S };
})();
if (typeof module === 'object') module.exports = WlProgress;
