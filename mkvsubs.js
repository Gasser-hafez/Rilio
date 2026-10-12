// الترجمة اللي جوه ملفات MKV/WebM — Chromium بيشغّل الصورة والصوت بس ومبيعرضهاش.
// parser صغير لـ Matroska (EBML): بيقرا رؤوس العناصر بس ويتخطى بيانات الصورة والصوت من غير ما يقراها،
// فملف 1.5GB بيخلص في ثواني. نصوص بس (SRT / ASS / WebVTT) — ترجمة الصور (PGS/VobSub) مش مدعومة.
// pure Node (من غير Electron) — test/mkvsubs.test.mjs بيختبره على ملف حقيقي صغير
const fs = require('fs');

const ID = {
  EBML: 0x1a45dfa3, Segment: 0x18538067, Info: 0x1549a966, TimecodeScale: 0x2ad7b1,
  Tracks: 0x1654ae6b, TrackEntry: 0xae, TrackNumber: 0xd7, TrackType: 0x83, CodecID: 0x86,
  Language: 0x22b59c, LanguageBCP47: 0x22b59d, Name: 0x536e,
  Cluster: 0x1f43b675, Timecode: 0xe7, SimpleBlock: 0xa3, BlockGroup: 0xa0, Block: 0xa1, BlockDuration: 0x9b,
};
// عناصر بننزل جواها بدل ما نتخطاها
const CONTAINERS = new Set([ID.Segment, ID.Info, ID.Tracks, ID.TrackEntry, ID.Cluster]);
const TEXT_CODECS = new Set(['S_TEXT/UTF8', 'S_TEXT/ASS', 'S_TEXT/SSA', 'S_TEXT/WEBVTT']);
const LANG2 = { ara: 'ar', eng: 'en', fre: 'fr', fra: 'fr', spa: 'es', ger: 'de', deu: 'de', ita: 'it', por: 'pt', tur: 'tr',
  rus: 'ru', jpn: 'ja', kor: 'ko', chi: 'zh', zho: 'zh', hin: 'hi', per: 'fa', fas: 'fa', heb: 'he', dut: 'nl', nld: 'nl' };

// قراية من الملف بنافذة صغيرة (رؤوس العناصر بس — بيانات الفيديو بنتخطاها بالـ position)
function reader(fd, size) {
  const WIN = 4096;
  let base = -1, buf = Buffer.alloc(0);
  return (pos, len) => {
    if (pos < 0 || pos >= size) return Buffer.alloc(0);
    len = Math.min(len, size - pos);
    if (base < 0 || pos < base || pos + len > base + buf.length) {
      const n = Math.max(len, WIN);
      buf = Buffer.alloc(Math.min(n, size - pos));
      fs.readSync(fd, buf, 0, buf.length, pos);
      base = pos;
    }
    return buf.subarray(pos - base, pos - base + len);
  };
}

// EBML variable-length int: id بيفضل فيه بت العلامة، الـ size لأ. size كله 1 = حجم مش معروف (null)
function vint(b, keepMarker) {
  if (!b.length) return null;
  const first = b[0];
  let len = 1;
  while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++;
  if (len > 8 || b.length < len) return null;
  let v = keepMarker ? first : first & (0xff >> len), allOnes = (first & (0xff >> len)) === (0xff >> len);
  for (let i = 1; i < len; i++) { v = v * 256 + b[i]; if (b[i] !== 0xff) allOnes = false; }
  return { v: !keepMarker && allOnes ? null : v, len };
}
const uint = b => b.reduce((a, x) => a * 256 + x, 0);

const ms = t => { t = Math.max(0, Math.round(t)); const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(t / 3600000))}:${p(Math.floor(t / 60000) % 60)}:${p(Math.floor(t / 1000) % 60)},${p(t % 1000, 3)}`; };
// نص ASS/SSA جوه MKV: "ReadOrder,Layer,Style,Name,MarginL,MarginR,MarginV,Effect,Text" — النص بعد الفاصلة التامنة، من غير التنسيق
function assText(s) {
  let i = -1;
  for (let n = 0; n < 8; n++) { i = s.indexOf(',', i + 1); if (i < 0) break; }
  const text = i >= 0 ? s.slice(i + 1) : s;
  return text.replace(/\{[^}]*\}/g, '').replace(/\\N|\\n/g, '\n').replace(/\\h/g, ' ').trim();
}

// ملف → [{ lang, name, codec, srt }] (ترجمة نصية بس). yieldEvery: كل كام عنصر نسيب الـ event loop يتنفس
async function extractSubs(file, { yieldEvery = 4000 } = {}) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size, read = reader(fd, size);
    const head = () => {
      const id = vint(read(pos, 4), true); if (!id) return null;
      const sz = vint(read(pos + id.len, 8), false); if (!sz) return null;
      return { id: id.v, size: sz.v, hl: id.len + sz.len };
    };
    let pos = 0, scale = 1000000, cluster = 0, steps = 0, clusterEnd = null, resyncs = 0;
    // ملف بايظ في حتة (تنزيل قديم متلخبط، أو المصدر نفسه): ندوّر على أول Cluster سليم بعدها ونكمّل — زي ffmpeg
    const CLUSTER = Buffer.from([0x1f, 0x43, 0xb6, 0x75]);
    const resync = from => {
      for (let p = from; p < size; p += (1 << 20) - 3) {
        const i = read(p, 1 << 20).indexOf(CLUSTER);
        if (i >= 0) return p + i;
      }
      return size;
    };
    const tracks = [], subs = new Map(); // رقم التراك → { ...cues }
    const block = (data, durTicks) => {
      const tn = vint(data, false); if (!tn) return;
      const t = subs.get(tn.v); if (!t || data.length < tn.len + 3) return;
      const rel = data.readInt16BE(tn.len), flags = data[tn.len + 2];
      if (flags & 0x06) return; // lacing — مش بيستخدم مع الترجمة
      let text = data.subarray(tn.len + 3).toString('utf8');
      if (t.ass) text = assText(text);
      const start = (cluster + rel) * scale / 1e6;
      const dur = durTicks != null ? durTicks * scale / 1e6 : 3000;
      text = text.replace(/\r/g, '').trim();
      // نفس السطر بنفس التوقيت مرتين = ملف متكرر جواه (شوف spliced تحت) — مرة واحدة كفاية
      const k = start + '|' + dur + '|' + text;
      if (text && !t.seen.has(k)) { t.seen.add(k); t.cues.push({ start, end: start + dur, text }); }
    };
    while (pos < size) {
      if (++steps % yieldEvery === 0) await new Promise(r => setImmediate(r));
      if (clusterEnd != null && pos >= clusterEnd) clusterEnd = null;
      const h = head();
      const bad = !h || (!CONTAINERS.has(h.id) && h.size != null && pos + h.hl + h.size > size) || (clusterEnd != null && h.size != null && pos + h.hl + h.size > clusterEnd);
      if (bad) {
        if (!subs.size || ++resyncs > 10000) break; // قبل التراكات مفيش حاجة نكمّل عليها
        pos = resync(pos + 1); clusterEnd = null; continue;
      }
      const body = pos + h.hl;
      if (h.id === ID.EBML) { pos = body + (h.size || 0); continue; }
      if (CONTAINERS.has(h.id)) {
        if (h.id === ID.TrackEntry) tracks.push({});
        if (h.id === ID.Cluster && !subs.size) break; // مفيش ترجمة نصية — منقراش الفيلم كله
        if (h.id === ID.Cluster) clusterEnd = h.size == null ? null : body + h.size;
        pos = body; continue;
      }
      if (h.size == null) { if (!subs.size) break; pos = resync(pos + 1); clusterEnd = null; continue; } // حجم مش معروف لعنصر عادي = بايظ
      const leaf = () => read(body, h.size);
      const tr = tracks[tracks.length - 1];
      switch (h.id) {
        case ID.TimecodeScale: scale = uint(leaf()) || scale; break;
        case ID.TrackNumber: if (tr) tr.num = uint(leaf()); break;
        case ID.TrackType: if (tr) tr.type = uint(leaf()); break;
        case ID.CodecID: if (tr) tr.codec = leaf().toString('latin1'); break;
        case ID.Language: if (tr && !tr.bcp) tr.lang = leaf().toString('latin1').replace(/\0/g, ''); break;
        case ID.LanguageBCP47: if (tr) { tr.bcp = true; tr.lang = leaf().toString('latin1').replace(/\0/g, ''); } break;
        case ID.Name: if (tr) tr.name = leaf().toString('utf8').replace(/\0/g, ''); break;
        case ID.Timecode: cluster = uint(leaf()); break;
        case ID.SimpleBlock: {
          const tn = vint(read(body, 8), false);
          if (tn && subs.has(tn.v)) block(Buffer.from(leaf()), null);
          break;
        }
        case ID.BlockGroup: {
          // جواه Block + BlockDuration — بنقرا الرؤوس بس، وبيانات الـ Block لو التراك ترجمة
          let p = body, data = null, dur = null; const end = body + h.size;
          while (p < end) {
            const id = vint(read(p, 4), true), sz = id && vint(read(p + id.len, 8), false);
            if (!id || !sz || sz.v == null) break;
            const b = p + id.len + sz.len;
            if (id.v === ID.Block) { const tn = vint(read(b, 8), false); if (tn && subs.has(tn.v)) data = Buffer.from(read(b, sz.v)); }
            else if (id.v === ID.BlockDuration) dur = uint(read(b, sz.v));
            p = b + sz.v;
          }
          if (data) block(data, dur);
          break;
        }
      }
      // أول ما التراكات تخلص: نحدد تراكات الترجمة النصية
      if (h.id === ID.CodecID || h.id === ID.TrackType || h.id === ID.TrackNumber) {
        for (const t of tracks) if (t.type === 0x11 && TEXT_CODECS.has(t.codec) && t.num && !subs.has(t.num))
          subs.set(t.num, Object.assign(t, { ass: /ASS|SSA/.test(t.codec), cues: [], seen: new Set() }));
      }
      pos = body + h.size;
    }
    return [...subs.values()].map(t => ({
      lang: LANG2[t.lang] || (/^[a-z]{2}(-|$)/i.test(t.lang || '') ? t.lang.slice(0, 2).toLowerCase() : ''),
      name: t.name || '', codec: t.codec,
      srt: t.cues.sort((a, b) => a.start - b.start).map((c, i) => `${i + 1}\n${ms(c.start)} --> ${ms(c.end)}\n${c.text}\n`).join('\n'),
      count: t.cues.length,
    })).filter(t => t.count);
  } finally { fs.closeSync(fd); }
}

// ملف اتنزل "متلزّق": سيرفر بيقول إنه بيكمّل التنزيل من النص (Range) وهو بيبعت الفيلم من الأول، فرأس الملف بيتكرر جواه
// والصورة والترجمة بيتكرروا. بندوّر على رأس الحاوية بتوقيع طويل (مش 4 بايت بس) عشان ميطلعش بالصدفة جوه بيانات الفيديو:
//  MKV/WebM: 1A45DFA3 + بعدها بشوية EBMLVersion (42 86 81 01)
//  MP4/MOV: [حجم 16..512]['ftyp'][نوع 4 حروف/أرقام]
async function spliced(file) {
  const ext = (file.match(/\.[^.\\/]+$/) || [''])[0].toLowerCase();
  const kind = /^\.(mkv|webm)$/.test(ext) ? 'ebml' : /^\.(mp4|m4v|mov)$/.test(ext) ? 'ftyp' : null;
  if (!kind) return false;
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size, CH = 8 << 20, buf = Buffer.alloc(CH + 16);
    const sig = kind === 'ebml' ? Buffer.from([0x1a, 0x45, 0xdf, 0xa3]) : Buffer.from('ftyp');
    const ok = (b, i) => {
      if (kind === 'ebml') { for (let j = i + 4; j < i + 14; j++) if (b[j] === 0x42 && b[j + 1] === 0x86 && b[j + 2] === 0x81 && b[j + 3] === 0x01) return true; return false; }
      if (i < 4) return false;
      const box = b.readUInt32BE(i - 4);
      return box >= 16 && box <= 512 && /^[A-Za-z0-9 ]{4}$/.test(b.toString('latin1', i + 4, i + 8));
    };
    for (let p = 0; p < size; p += CH) {
      const n = fs.readSync(fd, buf, 0, Math.min(CH + 16, size - p), p);
      for (let i = buf.subarray(0, n).indexOf(sig); i >= 0 && i < n; i = buf.subarray(0, n).indexOf(sig, i + 1)) {
        const at = p + i;
        if (at > (kind === 'ebml' ? 0 : 8) && i + 16 <= n && ok(buf, i)) return true;
      }
      await new Promise(r => setImmediate(r));
    }
    return false;
  } finally { fs.closeSync(fd); }
}

module.exports = { extractSubs, assText, spliced };
