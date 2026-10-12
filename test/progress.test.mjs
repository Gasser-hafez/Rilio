// منطق تتبع الحلقات (progress.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const P = createRequire(import.meta.url)('../progress.js');
const vs = (s, p, d = 2700) => ({ type: 'PLAYER_EVENT', data: { player_status: s, player_progress: p, player_duration: d } });
const vl = (e, t, d = 2700) => ({ type: 'PLAYER_EVENT', data: { event: e, currentTime: t, duration: d } });

test('parse: vsembed + vidlink shapes, other servers and junk ignored', () => {
  assert.deepEqual(P.parse(0, vs('playing', 100)), { pos: 100, dur: 2700, paused: false });
  assert.deepEqual(P.parse(3, vl('pause', 50)), { pos: 50, dur: 2700, paused: true });
  assert.equal(P.parse(1, vs('playing', 100)), null, 'server 2 sends nothing we trust');
  assert.equal(P.parse(4, vs('playing', 100)), null, 'custom server never tracked');
  for (const bad of [null, 'x', { type: 'PLAYER_EVENT' }, vs('playing', NaN), vs('playing', -1), vs('playing', 5, Infinity), vs('playing', '100'), vl('play', 1e7)])
    assert.equal(P.parse(0, bad) ?? P.parse(3, bad), null, JSON.stringify(bad));
});

test('step: done once at 90%, never again for the same episode', () => {
  const s = { done: false, savedAt: null };
  assert.equal(P.step(s, { pos: 10, dur: 2700, paused: false }), 'save');
  assert.equal(P.step(s, { pos: 20, dur: 2700, paused: false }), null);
  assert.equal(P.step(s, { pos: 2430, dur: 2700, paused: false }), 'done');
  assert.equal(P.step(s, { pos: 2500, dur: 2700, paused: false }), null);
  assert.equal(P.step(s, { pos: 10, dur: 2700, paused: true }), null, 'seeking back after done does nothing');
});

test('step: short videos (ads/trailers) and impossible positions are ignored', () => {
  const s = { done: false, savedAt: null };
  assert.equal(P.step(s, { pos: 29, dur: 30, paused: false }), null);
  assert.equal(P.step(s, { pos: 5000, dur: 2700, paused: false }), null);
  assert.equal(s.done, false);
});

test('step: resume saved every 30s of play and once per pause position', () => {
  const s = { done: false, savedAt: null };
  assert.equal(P.step(s, { pos: 0, dur: 2700, paused: false }), 'save');
  assert.equal(P.step(s, { pos: 29, dur: 2700, paused: false }), null);
  assert.equal(P.step(s, { pos: 31, dur: 2700, paused: false }), 'save');
  assert.equal(P.step(s, { pos: 40, dur: 2700, paused: true }), 'save');
  assert.equal(P.step(s, { pos: 40, dur: 2700, paused: true }), null, 'paused status repeats every 5s — no write storm');
});
