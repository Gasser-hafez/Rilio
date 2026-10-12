// الترجمة اللي جوه ملفات MKV (mkvsubs.js) — fixtures/subs.mkv اتعمل بـ ffmpeg: فيديو 4 ثواني + SRT عربي + ASS إنجليزي
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { extractSubs, assText, spliced } = createRequire(import.meta.url)('../mkvsubs.js');
const fixture = new URL('./fixtures/subs.mkv', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const made = [];
const mkdtemp = p => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); made.push(d); return d; };
process.on('exit', () => made.forEach(d => fs.rmSync(d, { recursive: true, force: true })));

test('extracts every text subtitle track with language, timing and text', async () => {
  const subs = await extractSubs(fixture);
  assert.deepEqual(subs.map(s => [s.lang, s.codec, s.count]), [['ar', 'S_TEXT/UTF8', 2], ['en', 'S_TEXT/ASS', 1]]);
  assert.equal(subs[0].srt, '1\n00:00:00,500 --> 00:00:01,500\nمرحبا\n\n2\n00:00:02,000 --> 00:00:03,250\nسطر تاني\nوسطر تالت\n');
  assert.equal(subs[1].name, 'English');
  assert.equal(subs[1].srt, '1\n00:00:01,000 --> 00:00:02,000\nHello, world\nSecond line\n', 'ASS styling stripped, \\N → new line');
});

test('ASS dialogue text: commas inside the text survive', () => {
  assert.equal(assText('3,0,Default,,0,0,0,,{\\b1}Wait,{\\b0} what?\\Nno'), 'Wait, what?\nno');
});

test('damaged file (broken cluster in the middle): skips to the next good cluster and keeps going', async () => {
  const buf = Buffer.from(fs.readFileSync(fixture));
  const CL = Buffer.from([0x1f, 0x43, 0xb6, 0x75]);
  const clusters = [];
  for (let i = buf.indexOf(CL); i >= 0; i = buf.indexOf(CL, i + 1)) clusters.push(i);
  assert.ok(clusters.length >= 4, 'fixture has several clusters');
  // نبوّظ أول cluster فيه بيانات (الحجم + أول عنصر) — زي الملف اللي اتنزل بايظ
  buf.fill(0, clusters[0] + 4, clusters[0] + 16);
  const dir = mkdtemp('wl-mkv-');
  const bad = path.join(dir, 'bad.mkv');
  fs.writeFileSync(bad, buf);
  const subs = await extractSubs(bad);
  const ar = subs.find(s => s.lang === 'ar');
  assert.ok(ar && /سطر تاني/.test(ar.srt), 'later Arabic line recovered after the damaged cluster: ' + JSON.stringify(subs));
});

test('spliced download (server restarted the file mid-way): detected for MKV and MP4; clean files and random data are not', async () => {
  const dir = mkdtemp('wl-spl-');
  const mkv = fs.readFileSync(fixture), rnd = Buffer.alloc(3 << 20);
  for (let i = 0; i < rnd.length; i++) rnd[i] = (i * 2654435761 >>> 13) & 0xff; // بيانات شكلها عشوائي
  const w = (n, b) => { const p = path.join(dir, n); fs.writeFileSync(p, b); return p; };
  assert.equal(await spliced(fixture), false, 'clean mkv');
  assert.equal(await spliced(w('twice.mkv', Buffer.concat([mkv, rnd, mkv]))), true, 'mkv header repeated inside');
  const ftyp = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(12)]);
  assert.equal(await spliced(w('ok.mp4', Buffer.concat([ftyp, rnd]))), false, 'clean mp4');
  assert.equal(await spliced(w('twice.mp4', Buffer.concat([ftyp, rnd, ftyp, rnd]))), true, 'mp4 restarted inside');
  assert.equal(await spliced(w('noise.mkv', Buffer.concat([mkv, rnd, Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3])]))), false, '4 magic bytes alone by chance do not count');
  assert.equal(await spliced(w('x.avi', Buffer.concat([mkv, mkv]))), false, 'unknown container: not checked');
});

test('a spliced MKV does not show the same subtitle line many times', async () => {
  const dir = mkdtemp('wl-spl-');
  const p = path.join(dir, 'twice.mkv');
  fs.writeFileSync(p, Buffer.concat([fs.readFileSync(fixture), fs.readFileSync(fixture)]));
  const ar = (await extractSubs(p)).find(s => s.lang === 'ar');
  assert.equal(ar.count, 2, 'each line once');
});

test('files that are not Matroska, or have no text subtitles, give nothing (no throw)', async () => {
  const dir = mkdtemp('wl-mkv-');
  const junk = path.join(dir, 'junk.mkv');
  fs.writeFileSync(junk, Buffer.alloc(5000, 7));
  assert.deepEqual(await extractSubs(junk), []);
  // نص الملف مقطوع في النص (تنزيل ناقص): بيرجع اللي لحقه من غير ما يقع
  const half = path.join(dir, 'half.mkv');
  fs.writeFileSync(half, fs.readFileSync(fixture).subarray(0, 1200));
  assert.ok(Array.isArray(await extractSubs(half)));
});
