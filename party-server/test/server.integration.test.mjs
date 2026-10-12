// بيشغّل السيرفر الحقيقي (Worker + Durable Object) محلياً بـ wrangler dev ويختبره بـ WebSockets حقيقية
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { newRoomCode } from '../src/protocol.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8799;
const BASE = `127.0.0.1:${PORT}`;
let proc;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const room = () => newRoomCode(randomBytes);
// تخزين الـ DO في فولدر مؤقت — wrangler dev بيحتفظ بالبيانات بين التشغيلات
const persist = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-party-'));

before(async () => {
  proc = spawn(process.execPath, [path.join(root, 'node_modules/wrangler/bin/wrangler.js'), 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', persist], { cwd: root, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    try { if ((await fetch(`http://${BASE}/room/AAAAAAAA`)).status === 426) return; } catch (e) {}
  }
  throw new Error('wrangler dev did not start');
});

after(() => {
  // wrangler بيشغّل workerd كـ process ابن — لازم نقفل الشجرة كلها
  if (process.platform === 'win32') { try { execSync(`taskkill /pid ${proc.pid} /T /F`, { stdio: 'ignore' }); } catch (e) {} }
  else proc.kill('SIGTERM');
});

// client بيجمّع الرسايل في طابور ونقدر نستنى رسالة بنوع معين
async function client(code) {
  const ws = new WebSocket(`ws://${BASE}/room/${code}`);
  const queue = [];
  let waiter = null;
  ws.onmessage = e => { queue.push(JSON.parse(e.data)); waiter?.(); };
  ws.onclose = e => { ws.closedWith = e.code; waiter?.(); };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.next = async (t, ms = 3000) => {
    const end = Date.now() + ms;
    for (;;) {
      const i = queue.findIndex(m => m.t === t);
      if (i >= 0) return queue.splice(i, 1)[0];
      if (Date.now() > end) throw new Error(`timeout waiting for ${t}; got ${JSON.stringify(queue)}`);
      await new Promise(r => { waiter = r; setTimeout(r, 100); });
    }
  };
  ws.sendJ = m => ws.send(typeof m === 'string' ? m : JSON.stringify(m));
  return ws;
}

const movie = { tmdbId: 550, type: 'movie', srv: 0, title: 'Fight Club' };

test('routing: bad room code 404, plain HTTP 426', async () => {
  assert.equal((await fetch(`http://${BASE}/room/bad`)).status, 404);
  assert.equal((await fetch(`http://${BASE}/room/AAAAAAAA/x`)).status, 404);
  assert.equal((await fetch(`http://${BASE}/room/AAAAAAAA`)).status, 426);
});

test('relay: media + state reach everyone in order, late joiner gets current state', async () => {
  const code = room();
  const a = await client(code);
  assert.deepEqual(await a.next('sync'), { t: 'sync', media: null, state: null, seq: 0, peers: 1 });
  const b = await client(code);
  await b.next('sync');
  assert.equal((await a.next('peers')).n, 2);

  a.sendJ({ t: 'media', media: movie });
  for (const c of [a, b]) assert.deepEqual(await c.next('media'), { t: 'media', media: movie, seq: 1 });
  b.sendJ({ t: 'state', paused: false, pos: 120 });
  for (const c of [a, b]) assert.deepEqual(await c.next('state'), { t: 'state', paused: false, pos: 120, age: 0, seq: 2 });

  await sleep(600);
  const c = await client(code);
  const s = await c.next('sync');
  assert.deepEqual(s.media, movie);
  assert.equal(s.state.paused, false);
  assert.equal(s.state.pos, 120);
  assert.ok(s.state.age >= 500, `age ${s.state.age}`);
  assert.equal(s.peers, 3);
  [a, b, c].forEach(x => x.close());
});

test('validation: bad json / url injection / unknown type rejected to sender only', async () => {
  const code = room();
  const a = await client(code); await a.next('sync');
  const b = await client(code); await b.next('sync');
  a.sendJ('{nope');
  assert.equal((await a.next('error')).code, 'bad_json');
  a.sendJ({ t: 'media', media: { ...movie, srv: 'https://evil.example' } });
  assert.equal((await a.next('error')).code, 'bad_media');
  a.sendJ({ t: 'admin', cmd: 'wipe' });
  assert.equal((await a.next('error')).code, 'unknown_type');
  await assert.rejects(b.next('media', 500), /timeout/);
  await assert.rejects(b.next('error', 300), /timeout/);
  a.close(); b.close();
});

test('binary frames close the socket', async () => {
  const a = await client(room()); await a.next('sync');
  a.send(new Uint8Array([1, 2, 3]));
  for (let i = 0; i < 30 && a.closedWith == null; i++) await sleep(100);
  assert.equal(a.closedWith, 1003);
});

test('rate limit kicks in after burst', async () => {
  const a = await client(room()); await a.next('sync');
  for (let i = 0; i < 40; i++) a.sendJ({ t: 'ping' });
  assert.equal((await a.next('error')).code, 'rate_limited');
  a.close();
});

test('room full: 9th peer rejected', async () => {
  const code = room();
  const peers = [];
  for (let i = 0; i < 8; i++) { const p = await client(code); await p.next('sync'); peers.push(p); }
  const extra = await client(code);
  assert.equal((await extra.next('error')).code, 'room_full');
  for (let i = 0; i < 30 && extra.closedWith == null; i++) await sleep(100);
  assert.equal(extra.closedWith, 4001);
  peers.forEach(p => p.close());
});

test('per-IP connection limit rejects a flood of new connections (runs last)', async () => {
  // fetch في Node مبيسمحش بـ Upgrade header — بنفتح WebSockets حقيقية لحد ما الـ handshake يترفض
  let rejected = false;
  for (let i = 0; i < 80 && !rejected; i++) {
    rejected = await new Promise(res => {
      const ws = new WebSocket(`ws://${BASE}/room/${room()}`);
      ws.onopen = () => { ws.close(); res(false); };
      ws.onerror = () => res(true);
    });
  }
  assert.equal(rejected, true);
});
