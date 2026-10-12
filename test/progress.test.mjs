// منطق تتبع الحلقات (progress.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const P = createRequire(import.meta.url)('../progress.js');
const vs = (s, p, d = 2700, info) => ({ type: 'PLAYER_EVENT', data: { player_status: s, player_progress: p, player_duration: d, ...(info ? { player_info: info } : {}) } });
const vl = (e, t, d = 2700, extra = {}) => ({ type: 'PLAYER_EVENT', data: { event: e, currentTime: t, duration: d, ...extra } });
const sess = () => ({ done: new Set(), ep: null, savedAt: null });
const at = (pos, paused = false, dur = 2700) => ({ pos, dur, paused });

test('parse: vsembed/vidsrc + vidlink shapes; junk ignored', () => {
  assert.deepEqual(P.parse(vs('playing', 100)), { pos: 100, dur: 2700, paused: false, tmdb: null, s: null, e: null });
  assert.deepEqual(P.parse(vl('pause', 50)), { pos: 50, dur: 2700, paused: true, tmdb: null, s: null, e: null });
  for (const bad of [null, 'x', { type: 'PLAYER_EVENT' }, { type: 'PLAYER_EVENT', data: { foo: 1 } }, vs('playing', NaN), vs('playing', -1),
    vs('playing', 5, Infinity), vs('playing', '100'), vl('play', 1e7), { type: 'TV_STATE', season: 1, episode: 2 }])
    assert.equal(P.parse(bad), null, JSON.stringify(bad));
});

test('parse: the episode the player is really playing (vidsrc player_info, vidlink fields)', () => {
  // شكل حقيقي متسجّل من vidsrc.sh (vidsrc-embed.ru بيحوّل عليه)
  const real = vs('playing', 11.8, 3480, { imdb: null, tmdb: '1396', mediaType: 'tv', season: 1, episode: 5, title: 'x' });
  assert.deepEqual(P.parse(real), { pos: 11.8, dur: 3480, paused: false, tmdb: 1396, s: 1, e: 5 });
  assert.deepEqual(P.parse(vl('play', 10, 2700, { mtmdbId: 1396, season: 2, episode: 3 })), { pos: 10, dur: 2700, paused: false, tmdb: 1396, s: 2, e: 3 });
  // أرقام بايظة = كأنه مبعتهاش (نرجع لحلقة البرنامج)
  const r = P.parse(vs('playing', 10, 2700, { tmdb: '<b>', season: 0, episode: '2' }));
  assert.deepEqual([r.tmdb, r.s, r.e], [null, null, null]);
});

test('step: done once per episode at 90%; another episode in the same player counts on its own', () => {
  const s = sess();
  assert.equal(P.step(s, at(10), '1x1'), 'save');
  assert.equal(P.step(s, at(2430), '1x1'), 'done');
  assert.equal(P.step(s, at(2500), '1x1'), null);
  assert.equal(P.step(s, at(10, true), '1x1'), null, 'seeking back after done does nothing');
  assert.equal(P.step(s, at(5), '1x2'), 'save', 'picked next episode inside the player');
  assert.equal(P.step(s, at(2450), '1x2'), 'done');
});

test('step: short videos (ads/trailers) and impossible positions are ignored', () => {
  const s = sess();
  assert.equal(P.step(s, at(29, false, 30), '1x1'), null);
  assert.equal(P.step(s, at(5000), '1x1'), null);
  assert.equal(s.done.size, 0);
});

test('step: resume saved every 30s of play and once per pause position', () => {
  const s = sess();
  assert.equal(P.step(s, at(0), '1x1'), 'save');
  assert.equal(P.step(s, at(29), '1x1'), null);
  assert.equal(P.step(s, at(31), '1x1'), 'save');
  assert.equal(P.step(s, at(40, true), '1x1'), 'save');
  assert.equal(P.step(s, at(40, true), '1x1'), null, 'paused status repeats every 5s — no write storm');
});
