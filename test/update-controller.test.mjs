import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
const { createUpdateController, errorCode } = createRequire(import.meta.url)('../update-controller.js');

// updater وهمي بنفس الأحداث والدوال اللي بنستخدمها من electron-updater
function fakeUpdater(script) {
  const u = new EventEmitter();
  u.checks = 0; u.installed = 0;
  u.checkForUpdates = async () => { u.checks++; await script(u); return {}; };
  u.quitAndInstall = () => { u.installed++; };
  return u;
}
const ctl = (u, packaged = true) => createUpdateController({ updater: u, isPackaged: packaged, currentVersion: '4.4.0' });

test('up to date', async () => {
  const u = fakeUpdater(async x => { x.emit('checking-for-update'); x.emit('update-not-available', { version: '4.4.0' }); });
  const c = ctl(u);
  assert.equal(c.getState().status, 'idle');
  const s = await c.check();
  assert.equal(s.status, 'up-to-date');
  assert.equal(s.current, '4.4.0');
  assert.equal(c.install(), false, 'nothing to install');
  assert.equal(u.installed, 0);
});

test('new version: downloading with clamped progress, then downloaded, then install', async () => {
  const u = fakeUpdater(async x => { x.emit('checking-for-update'); x.emit('update-available', { version: '4.5.0' }); });
  const c = ctl(u);
  const seen = [];
  c.onChange(s => seen.push(s.status + (s.status === 'downloading' ? s.percent : '')));
  assert.equal((await c.check()).status, 'downloading');
  u.emit('download-progress', { percent: 42.6 });
  u.emit('download-progress', { percent: 180 });
  assert.equal(c.getState().percent, 100);
  assert.equal(c.install(), false, 'not installable before download finishes');
  u.emit('update-downloaded', { version: '4.5.0' });
  assert.deepEqual({ s: c.getState().status, v: c.getState().version }, { s: 'downloaded', v: '4.5.0' });
  assert.deepEqual(seen, ['checking', 'downloading0', 'downloading43', 'downloading100', 'downloaded']);
  assert.equal(c.install(), true);
  assert.equal(u.installed, 1);
});

test('checking again while downloading/downloaded does not hit the server', async () => {
  const u = fakeUpdater(async x => { x.emit('update-available', { version: '4.5.0' }); });
  const c = ctl(u);
  await c.check();
  await c.check();
  u.emit('update-downloaded', { version: '4.5.0' });
  await c.check();
  assert.equal(u.checks, 1);
});

test('concurrent checks share one request', async () => {
  let release;
  const u = fakeUpdater(async x => { x.emit('checking-for-update'); await new Promise(r => { release = r; }); x.emit('update-not-available'); });
  const c = ctl(u);
  const a = c.check(), b = c.check();
  await new Promise(r => setImmediate(r));
  release();
  assert.equal((await a).status, 'up-to-date');
  assert.equal((await b).status, 'up-to-date');
  assert.equal(u.checks, 1);
});

test('offline vs other errors; a later error does not cancel a downloaded update', async () => {
  const u = fakeUpdater(async x => { x.emit('checking-for-update'); const e = new Error('net::ERR_INTERNET_DISCONNECTED'); x.emit('error', e); throw e; });
  const c = ctl(u);
  assert.deepEqual(await c.check().then(s => [s.status, s.error]), ['error', 'OFFLINE']);
  assert.equal(errorCode(new Error('HttpError: 404')), 'FAILED');
  u.emit('update-downloaded', { version: '4.5.0' });
  u.emit('error', new Error('net::ERR_NETWORK_CHANGED'));
  assert.equal(c.getState().status, 'downloaded');
});

test('check that resolves without a verdict does not leave the UI stuck on "checking"', async () => {
  const u = fakeUpdater(async x => { x.emit('checking-for-update'); });
  assert.equal((await ctl(u).check()).status, 'error');
});

test('dev (not installed): never touches the updater', async () => {
  const u = fakeUpdater(async () => { throw new Error('should not be called'); });
  const c = ctl(u, false);
  assert.equal((await c.check()).status, 'dev');
  assert.equal(c.install(), false);
  assert.equal(u.checks, 0);
});
