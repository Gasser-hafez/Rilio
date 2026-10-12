import { test } from 'node:test';
import assert from 'node:assert/strict';
import { embedUrl, parsePlayerEvent, createGuestSync, SERVER_ORIGINS, fmtTime } from '../public/guest-logic.mjs';

test('embed URLs: movie strips season/episode, tv fills them, only ids from validated media', () => {
  assert.equal(embedUrl({ tmdbId: 550, type: 'movie', srv: 0 }), 'https://vsembed.ru/embed/movie?tmdb=550&ds_lang=ar&sub_lang=ar');
  assert.equal(embedUrl({ tmdbId: 1396, type: 'tv', srv: 3, season: 2, episode: 5 }), 'https://vidlink.pro/tv/1396/2/5?ds_lang=ar&sub_lang=ar');
  assert.equal(embedUrl({ tmdbId: 550, type: 'movie', srv: 3 }), 'https://vidlink.pro/movie/550?ds_lang=ar&sub_lang=ar');
  assert.equal(embedUrl({ tmdbId: 550, type: 'movie', srv: 2 }), 'https://player.embed-api.stream/?id=550&ds_lang=ar&sub_lang=ar');
  assert.equal(embedUrl({ tmdbId: 550, type: 'movie', srv: 9 }).startsWith('https://vsembed.ru/'), true, 'unknown server → server 1');
  assert.equal(embedUrl({ tmdbId: '550"><script>', type: 'movie', srv: 0 }), null);
  assert.equal(embedUrl({ tmdbId: 550, type: 'movie', srv: 'https://evil' }), null);
  assert.deepEqual(SERVER_ORIGINS, ['https://vsembed.ru', 'https://vidsrc.cc', 'https://player.embed-api.stream', 'https://vidlink.pro']);
});

test('player events: vsembed status/progress and vidlink event/currentTime (real shapes from spike)', () => {
  const vs = (s, p) => ({ type: 'PLAYER_EVENT', data: { player_status: s, player_progress: p, player_duration: 8348 } });
  const vl = (e, t) => ({ type: 'PLAYER_EVENT', data: { event: e, currentTime: t, duration: 3500 } });
  assert.deepEqual(parsePlayerEvent(0, vs('playing', 20.4)), { paused: false, pos: 20.4 });
  assert.deepEqual(parsePlayerEvent(0, vs('paused', 4)), { paused: true, pos: 4 });
  assert.deepEqual(parsePlayerEvent(0, vs('seeked', 9)), { paused: null, pos: 9 });
  assert.deepEqual(parsePlayerEvent(3, vl('timeupdate', 5.99)), { paused: null, pos: 5.99 });
  assert.deepEqual(parsePlayerEvent(3, vl('pause', 7)), { paused: true, pos: 7 });
  assert.equal(parsePlayerEvent(0, vs('playing', -1)), null);
  assert.equal(parsePlayerEvent(0, vs('playing', 'x')), null);
  assert.equal(parsePlayerEvent(1, vs('playing', 3)), null, 'server 2 sends nothing we trust');
  assert.equal(parsePlayerEvent(0, { type: 'PLAYER_TITLE' }), null);
});

const T0 = 1_000_000;
const at = s => T0 + s * 1000;

test('guest starts playback while the room is paused → everyone plays from guest position', () => {
  const g = createGuestSync();
  g.onRoom({ paused: true, pos: 0 }, at(0));
  assert.deepEqual(g.onPlayer({ paused: false, pos: 0.5 }, at(1)), { send: { paused: false, pos: 0.5 } });
});

test('guest presses play late while room already plays → no send (just catching up), hint says seek', () => {
  const g = createGuestSync();
  g.onRoom({ paused: false, pos: 600 }, at(0));
  assert.deepEqual(g.onPlayer({ paused: false, pos: 0 }, at(5)), {});
  assert.deepEqual(g.hint(at(5)), { kind: 'seek', pos: 605 });
  // بيقدّم بإيده لمكان الأوضة → مبنبعتش (كان مش معاهم قبل القفزة)، والشريط يختفي
  assert.deepEqual(g.onPlayer({ paused: null, pos: 606 }, at(6)), {});
  assert.equal(g.hint(at(6)), null);
});

test('room paused by the app user while guest still playing → no send (no override), hint says pause', () => {
  const g = createGuestSync();
  g.onRoom({ paused: false, pos: 100 }, at(0));
  g.onPlayer({ paused: false, pos: 100 }, at(0));
  g.onRoom({ paused: true, pos: 110 }, at(10));
  // vsembed لسه بيقول "playing" — ده مش ضغطة من الضيف
  assert.deepEqual(g.onPlayer({ paused: false, pos: 112 }, at(12)), {});
  assert.deepEqual(g.hint(at(12)), { kind: 'pause', pos: 110 });
  // الضيف داس pause → الأوضة واقفة أصلاً، مفيش داعي نبعت
  assert.deepEqual(g.onPlayer({ paused: true, pos: 113 }, at(13)), {});
  assert.deepEqual(g.hint(at(13)), null);
});

test('guest pauses while in sync → room pauses at guest position; out of sync → at room position', () => {
  const g = createGuestSync();
  g.onRoom({ paused: false, pos: 200 }, at(0));
  g.onPlayer({ paused: false, pos: 200 }, at(0));
  assert.deepEqual(g.onPlayer({ paused: true, pos: 205 }, at(5)), { send: { paused: true, pos: 205 } });

  const h = createGuestSync();
  h.onRoom({ paused: false, pos: 900 }, at(0));
  h.onPlayer({ paused: false, pos: 10 }, at(0)); // لسه مش معاهم
  assert.deepEqual(h.onPlayer({ paused: true, pos: 15 }, at(5)), { send: { paused: true, pos: 905 } });
});

test('guest seeks while in sync → everyone follows; normal progress is not a seek', () => {
  const g = createGuestSync();
  g.onRoom({ paused: false, pos: 300 }, at(0));
  g.onPlayer({ paused: false, pos: 300 }, at(0));
  assert.deepEqual(g.onPlayer({ paused: null, pos: 305 }, at(5)), {}, 'just playing');
  assert.deepEqual(g.onPlayer({ paused: null, pos: 1200 }, at(6)), { send: { paused: false, pos: 1200 } });
});

test('echo: room state coming back after guest action leaves no hint', () => {
  const g = createGuestSync();
  g.onRoom({ paused: true, pos: 0 }, at(0));
  const { send } = g.onPlayer({ paused: false, pos: 1 }, at(1));
  g.onRoom(send, at(1.2));
  assert.equal(g.hint(at(2)), null);
});

test('no room yet → never sends; hint before the guest presses play', () => {
  const g = createGuestSync();
  assert.deepEqual(g.onPlayer({ paused: false, pos: 3 }, at(0)), {});
  assert.equal(g.hint(at(0)), null);
  const h = createGuestSync();
  h.onRoom({ paused: false, pos: 50 }, at(0));
  assert.deepEqual(h.hint(at(2)), { kind: 'play', pos: 52 });
});

test('time format', () => {
  assert.equal(fmtTime(65), '1:05');
  assert.equal(fmtTime(3725), '1:02:05');
  assert.equal(fmtTime(-3), '0:00');
});
