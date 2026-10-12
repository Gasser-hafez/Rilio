import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { playerUrl, playerBounds } = createRequire(import.meta.url)('../embedded-player.js');

test('embedded player only loads plain http(s) URLs', () => {
  assert.equal(playerUrl('https://vidlink.pro/movie/550'), 'https://vidlink.pro/movie/550');
  assert.equal(playerUrl('javascript:alert(1)'), null);
  assert.equal(playerUrl('file:///C:/Windows/win.ini'), null);
  assert.equal(playerUrl('https://u:p@example.com/'), null);
  assert.equal(playerUrl('https://example.com/' + 'a'.repeat(5000)), null);
  assert.equal(playerUrl(null), null);
});

test('embedded player bounds are rounded and clamped to the window', () => {
  assert.deepEqual(playerBounds({ x: 10.4, y: 20.6, width: 100, height: 50 }, [800, 600]), { x: 10, y: 21, width: 100, height: 50 });
  assert.deepEqual(playerBounds({ x: -20, y: 500, width: 900, height: 300 }, [800, 600]), { x: 0, y: 500, width: 800, height: 100 });
  assert.equal(playerBounds({ x: 0, y: 0, width: NaN, height: 10 }, [800, 600]), null);
  assert.equal(playerBounds(null, [800, 600]), null);
});
