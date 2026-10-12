// البرنامج ميطلعش نوافذ ويندوز (confirm/alert/prompt) — كله بنافذة uiConfirm جوه البرنامج
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const NATIVE = /(^|[^.\w$])(confirm|alert|prompt)\s*\(/;

for (const f of ['app.js', 'party-server/public/guest.js']) {
  test(`${f}: no native confirm/alert/prompt`, () => {
    const hits = fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8').split('\n')
      .map((l, i) => [i + 1, l]).filter(([, l]) => NATIVE.test(l) && !/^\s*\/\//.test(l));
    assert.deepEqual(hits, [], 'use uiConfirm(): ' + hits.map(([n, l]) => `${n}: ${l.trim()}`).join(' | '));
  });
}
