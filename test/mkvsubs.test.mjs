// الترجمة اللي جوه ملفات MKV (mkvsubs.js) — fixtures/subs.mkv اتعمل بـ ffmpeg: فيديو 4 ثواني + SRT عربي + ASS إنجليزي
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { extractSubs, assText } = createRequire(import.meta.url)('../mkvsubs.js');
const fixture = new URL('./fixtures/subs.mkv', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-mkv-'));
  const bad = path.join(dir, 'bad.mkv');
  fs.writeFileSync(bad, buf);
  const subs = await extractSubs(bad);
  const ar = subs.find(s => s.lang === 'ar');
  assert.ok(ar && /سطر تاني/.test(ar.srt), 'later Arabic line recovered after the damaged cluster: ' + JSON.stringify(subs));
});

test('files that are not Matroska, or have no text subtitles, give nothing (no throw)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-mkv-'));
  const junk = path.join(dir, 'junk.mkv');
  fs.writeFileSync(junk, Buffer.alloc(5000, 7));
  assert.deepEqual(await extractSubs(junk), []);
  // نص الملف مقطوع في النص (تنزيل ناقص): بيرجع اللي لحقه من غير ما يقع
  const half = path.join(dir, 'half.mkv');
  fs.writeFileSync(half, fs.readFileSync(fixture).subarray(0, 1200));
  assert.ok(Array.isArray(await extractSubs(half)));
});
