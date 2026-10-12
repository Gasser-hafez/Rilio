import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  isRoomCode, newRoomCode, validMedia, parseClientMessage, applyMessage, snapshot, rateLimit,
  emptyRoom, parseServerMessage, RATE_MAX_MESSAGES, RATE_WINDOW_MS, MAX_MESSAGE_BYTES,
} from '../src/protocol.mjs';

const movie = { tmdbId: 550, type: 'movie', srv: 0, title: 'Fight Club' };
const ep = { tmdbId: 1399, type: 'tv', srv: 1, season: 2, episode: 5, title: 'GoT' };

test('room codes: generated codes are valid, confusable chars rejected', () => {
  for (let i = 0; i < 200; i++) assert.ok(isRoomCode(newRoomCode(randomBytes)));
  for (const bad of ['', 'ABCDEFG', 'ABCDEFGHJ', 'abcdefgh', 'ABCDEFG0', 'ABCDEFGI', 'ABCD/EFG', null, 12345678]) assert.equal(isRoomCode(bad), false, String(bad));
});

test('media: only ids and fixed-list server index, never URLs', () => {
  assert.deepEqual(validMedia(movie), movie);
  assert.deepEqual(validMedia(ep), ep);
  assert.equal(validMedia({ ...movie, url: 'javascript:alert(1)' }).url, undefined, 'extra fields dropped');
  assert.equal(validMedia({ ...movie, srv: 'https://evil' }), null);
  assert.equal(validMedia({ ...movie, srv: 32 }), null);
  assert.equal(validMedia({ ...movie, tmdbId: '550' }), null);
  assert.equal(validMedia({ ...movie, tmdbId: 1.5 }), null);
  assert.equal(validMedia({ ...movie, type: 'game' }), null);
  assert.equal(validMedia({ ...ep, season: 0 }), null);
  assert.equal(validMedia({ ...ep, episode: undefined }), null);
  assert.equal(validMedia({ ...movie, title: 'x'.repeat(500) }).title.length, 120);
});

test('client messages: size, json, type and field validation', () => {
  assert.equal(parseClientMessage('x'.repeat(MAX_MESSAGE_BYTES + 1)).code, 'too_big');
  assert.equal(parseClientMessage('{oops').code, 'bad_json');
  assert.equal(parseClientMessage('null').code, 'bad_json');
  assert.equal(parseClientMessage('{"t":"admin"}').code, 'unknown_type');
  assert.equal(parseClientMessage(JSON.stringify({ t: 'state', paused: 'yes', pos: 1 })).code, 'bad_state');
  assert.equal(parseClientMessage(JSON.stringify({ t: 'state', paused: true, pos: -1 })).code, 'bad_state');
  assert.equal(parseClientMessage(JSON.stringify({ t: 'state', paused: true, pos: Infinity })).ok, false);
  assert.deepEqual(parseClientMessage(JSON.stringify({ t: 'state', paused: false, pos: 12.5, extra: 1 })).msg, { t: 'state', paused: false, pos: 12.5 });
  assert.deepEqual(parseClientMessage(JSON.stringify({ t: 'media', media: movie })).msg, { t: 'media', media: movie });
});

test('room: media resets playback; state without media ignored; seq increases', () => {
  let r = emptyRoom();
  let out = applyMessage(r, { t: 'state', paused: false, pos: 10 }, 1000);
  assert.equal(out.broadcast, null, 'no media yet');
  out = applyMessage(r, { t: 'media', media: movie }, 1000);
  r = out.room;
  assert.deepEqual(r.state, { paused: true, pos: 0, ts: 1000 });
  assert.equal(out.broadcast.seq, 1);
  out = applyMessage(r, { t: 'state', paused: false, pos: 42 }, 2000);
  r = out.room;
  assert.deepEqual(out.broadcast, { t: 'state', paused: false, pos: 42, age: 0, seq: 2 });
  assert.equal(r.touched, 2000);
});

test('snapshot: late joiner gets elapsed age, not wall-clock timestamps', () => {
  let r = applyMessage(emptyRoom(), { t: 'media', media: movie }, 1000).room;
  r = applyMessage(r, { t: 'state', paused: false, pos: 100 }, 5000).room;
  const s = snapshot(r, 8000, 2);
  assert.deepEqual(s, { t: 'sync', media: movie, state: { paused: false, pos: 100, age: 3000 }, seq: 2, peers: 2 });
  assert.deepEqual(snapshot(emptyRoom(), 1, 1), { t: 'sync', media: null, state: null, seq: 0, peers: 1 });
});

test('rate limit: N messages per window, resets after window', () => {
  let rl = null, allowed;
  for (let i = 0; i < RATE_MAX_MESSAGES; i++) ({ allowed, rl } = rateLimit(rl, 100));
  assert.equal(allowed, true);
  ({ allowed, rl } = rateLimit(rl, 200));
  assert.equal(allowed, false);
  ({ allowed } = rateLimit(rl, 100 + RATE_WINDOW_MS));
  assert.equal(allowed, true);
});

test('server messages: client re-validates everything from the server', () => {
  assert.deepEqual(parseServerMessage(JSON.stringify({ t: 'state', paused: true, pos: 3, age: 0, seq: 4 })), { t: 'state', paused: true, pos: 3, age: 0, seq: 4 });
  assert.equal(parseServerMessage(JSON.stringify({ t: 'media', media: { ...movie, srv: 'x' }, seq: 1 })), null);
  assert.equal(parseServerMessage(JSON.stringify({ t: 'sync', media: { tmdbId: -1 }, state: null, seq: 0, peers: 1 })), null);
  assert.equal(parseServerMessage(JSON.stringify({ t: 'sync', media: null, state: null, seq: 0, peers: 99 })), null);
  assert.equal(parseServerMessage(JSON.stringify({ t: 'eval', code: 'x' })), null);
  assert.equal(parseServerMessage('x'.repeat(5000)), null);
});
