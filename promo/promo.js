// تايملاين فيديو rilio: كل حاجة دالة في الوقت t (بالثواني). render.mjs بينادي window.seek(t) لكل فريم.
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, p) => a + (b - a) * p;
const EASE = {
  lin: p => p,
  out: p => 1 - Math.pow(1 - p, 3),
  in: p => p * p * p,
  io: p => (p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
  back: p => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2); },
  expo: p => (p === 1 ? 1 : 1 - Math.pow(2, -10 * p)),
};
const DURATION = 132;

// ---------- بوسترات مرسومة (مفيش صور حقيقية — ألوان وأشكال توحي بالعمل) ----------
const ART = {
  'Dark': 'radial-gradient(circle at 50% 38%,#ffd36e 0 7%,rgba(255,211,110,.35) 12%,transparent 30%),repeating-linear-gradient(90deg,transparent 0 22px,rgba(0,0,0,.55) 22px 30px),linear-gradient(#123331,#050b0b)',
  'The Dark Knight': 'radial-gradient(ellipse at 50% 110%,#ff7a1a 0,#a3360c 30%,transparent 60%),linear-gradient(#0b1424,#04060b)',
  'Dark Matter': 'repeating-linear-gradient(0deg,transparent 0 40px,rgba(185,162,255,.18) 40px 42px),radial-gradient(circle at 50% 50%,#2a1f5e,#0a0718 70%)',
  'Dark Waters': 'radial-gradient(ellipse at 50% 20%,#4f8f86,transparent 60%),linear-gradient(#1c3a36,#08130f)',
  'Severance': 'linear-gradient(transparent 62%,rgba(0,0,0,.25) 62%),repeating-linear-gradient(90deg,#d9eef0 0 60px,#c3e2e6 60px 62px),linear-gradient(#e8f6f7,#9ccfd6)',
  'Dune: Part Two': 'radial-gradient(ellipse 80% 30% at 30% 75%,#8c3b12 0 60%,transparent 61%),radial-gradient(ellipse 90% 30% at 80% 88%,#6b2a0c 0 60%,transparent 61%),radial-gradient(circle at 70% 30%,#fff1c9 0 6%,transparent 7%),linear-gradient(#f4c27a,#d86d26 70%,#7a300c)',
  'Shōgun': 'radial-gradient(circle at 50% 42%,#e2231a 0 26%,transparent 26.5%),linear-gradient(#141010,#050404)',
  'Interstellar': 'radial-gradient(circle at 50% 45%,#000 0 14%,#ffd9a0 15%,#ff9a3c 18%,rgba(255,140,60,.25) 26%,transparent 40%),radial-gradient(ellipse 70% 6% at 50% 45%,#ffe0b0,transparent 70%),linear-gradient(#06070d,#000)',
  'Arrival': 'radial-gradient(ellipse 22% 38% at 50% 44%,#1a1d20 0 96%,transparent 100%),linear-gradient(#b8bfc2,#5d6669 70%,#2c3133)',
  'The Bear': 'repeating-linear-gradient(90deg,#1b3354 0 40px,#203d63 40px 80px),linear-gradient(#0f2340,#0f2340)',
  'Arcane': 'radial-gradient(circle at 25% 30%,#ff4fa0,transparent 45%),radial-gradient(circle at 80% 70%,#2ee6d6,transparent 45%),linear-gradient(135deg,#2a0d4a,#120624)',
  'Blade Runner 2049': 'radial-gradient(ellipse at 50% 80%,#ff7b3a,transparent 60%),linear-gradient(#f2a35c,#a8432a 60%,#3a0f1d)',
  'Annihilation': 'conic-gradient(from 30deg at 50% 60%,#ff6ad5,#c774e8,#ad8cff,#8795e8,#94d0ff,#6ef0c3,#ff6ad5)',
  'Coherence': 'linear-gradient(160deg,transparent 45%,rgba(255,255,255,.8) 49%,transparent 52%),radial-gradient(circle at 70% 25%,#3a4b8a,transparent 50%),linear-gradient(#0b1030,#03040d)',
  'Knives Out': 'radial-gradient(circle at 50% 45%,transparent 0 22%,#d4a24c 22.5% 24%,transparent 24.5%),linear-gradient(#5a1414,#1d0606)',
  'Oppenheimer': 'radial-gradient(circle at 50% 55%,#fff3c4 0 4%,#ff9a2e 10%,#c43a0c 22%,transparent 40%),linear-gradient(#120806,#000)',
  'Breaking Bad': 'radial-gradient(ellipse 120% 40% at 50% 100%,#9a8a3a,transparent 70%),linear-gradient(#2f5a2a,#c9c25a 70%,#857a2a)',
  'Parasite': 'linear-gradient(transparent 70%,#0b0b0b 70% 76%,transparent 76%),linear-gradient(#7d9a6a,#3f5236)',
};
function poster(name, w, h, cls = '') {
  const d = document.createElement('div');
  d.className = 'poster ' + cls;
  if (w) d.style.width = w + 'px';
  if (h) d.style.height = h + 'px';
  d.innerHTML = `<div class="art" style="background:${ART[name] || '#333'}"></div><div class="pt">${name}</div>`;
  return d;
}
function mount(sel, el) { const host = $(sel); host.replaceWith(el); if (host.id) el.id = host.id; return el; }

// ---------- محرك التوينز ----------
const tracks = new Map();
const hooks = [];
let uidN = 0;
const uid = el => (el.__u ||= ++uidN);
function tw(target, key, start, dur, fn, ease = 'out') {
  const els = typeof target === 'string' ? $$(target) : [].concat(target);
  if (!els.length) console.warn('no target', target);
  els.forEach((el, i) => {
    const k = key + '|' + uid(el);
    if (!tracks.has(k)) tracks.set(k, []);
    tracks.get(k).push({ start, dur, fn, ease: EASE[ease] || ease, el, i });
    tracks.get(k).sort((a, b) => a.start - b.start);
  });
}
function setv(el, prop, v) { if (prop.startsWith('--')) el.style.setProperty(prop, v); else el.style[prop] = v; }
// v: يحرّك خاصية من قيمة لقيمة
function v(target, prop, start, dur, from, to, ease = 'out', unit = '') {
  tw(target, prop, start, dur, (p, el) => setv(el, prop, lerp(from, to, p) + unit), ease);
}
const set = (target, prop, t, val) => tw(target, prop, t, 0.0001, (p, el) => setv(el, prop, val), 'lin');
const hook = fn => hooks.push(fn);

// اختصارات الحركة
function inUp(sel, t, d = .7, dist = 40, stagger = 0) {
  $$(sel).forEach((el, i) => { v(el, 'opacity', t + i * stagger, d, 0, 1); v(el, '--y', t + i * stagger, d, dist, 0, 'out', 'px'); });
}
function inSide(sel, t, d = .8, dist = -80) { v(sel, 'opacity', t, d, 0, 1); v(sel, '--x', t, d, dist, 0, 'out', 'px'); }
function pop(sel, t, d = .55, from = .6, stagger = 0) {
  $$(sel).forEach((el, i) => { v(el, 'opacity', t + i * stagger, d * .6, 0, 1); v(el, '--s', t + i * stagger, d, from, 1, 'back'); });
}
function outFade(sel, t, d = .4) { v(sel, 'opacity', t, d, 1, 0, 'in'); }
function typeText(sel, start, dur, text) {
  const chars = [...text];
  tw(sel, 'text', start, dur, (p, el) => { el.textContent = chars.slice(0, Math.round(p * chars.length)).join(''); }, 'lin');
}
function caption(sid, t) {
  const s = '#' + sid + ' .cap ';
  inUp(s + '.kick', t, .6, 24);
  inUp(s + 'h2', t + .15, .8, 40);
  inUp(s + 'p', t + .35, .8, 30);
  inUp(s + '.chips .chip', t + .9, .5, 20, .12);
}

// ---------- المشاهد ----------
const SCENES = [];
function scene(id, start, end) {
  SCENES.push({ el: $('#' + id), start, end });
  return start;
}
hook(t => {
  for (const s of SCENES) {
    const on = t >= s.start && t < s.end;
    s.el.style.display = on ? 'block' : 'none';
    if (!on) continue;
    const pin = clamp((t - s.start) / .6), pout = clamp((s.end - t) / .5);
    s.el.style.opacity = Math.min(EASE.out(pin), EASE.out(pout));
    const sc = lerp(1.035, 1, EASE.out(pin)) * lerp(.985, 1, EASE.out(pout));
    s.el.style.transform = `scale(${sc})`;
    s.el.style.filter = pout < 1 ? `blur(${(1 - pout) * 8}px)` : 'none';
  }
});

// ---------- الماوس ----------
const cursorPaths = [];
// pts: [[t, target|[x,y], click?]]
function cursor(pts) { cursorPaths.push(pts); }
function resolveCursor() {
  for (const pts of cursorPaths) for (const p of pts) {
    if (typeof p[1] === 'string') {
      seek(p[0]);
      const r = $(p[1]).getBoundingClientRect();
      p[1] = [r.left + r.width * .5, r.top + r.height * .55];
    }
  }
}
hook(t => {
  const c = $('#cursor'), rp = $('#ripple');
  c.style.opacity = 0; rp.style.opacity = 0;
  for (const pts of cursorPaths) {
    const t0 = pts[0][0], t1 = pts[pts.length - 1][0];
    if (t < t0 - .3 || t > t1 + .5) continue;
    if (!Array.isArray(pts[0][1])) continue; // لسه متحسبتش
    let x = pts[0][1][0], y = pts[0][1][1];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ta, a] = pts[i], [tb, b] = pts[i + 1];
      if (t >= ta && t <= tb) { const p = EASE.io((t - ta) / (tb - ta)); x = lerp(a[0], b[0], p); y = lerp(a[1], b[1], p); }
      else if (t > tb) { x = b[0]; y = b[1]; }
    }
    const op = Math.min(clamp((t - (t0 - .3)) / .3), clamp((t1 + .5 - t) / .3));
    let sc = 1;
    for (const p of pts) if (p[2]) {
      const dt = t - p[0];
      if (dt > -.08 && dt < .15) sc = .82;
      if (dt >= 0 && dt < .5) { const q = dt / .5; rp.style.opacity = (1 - q) * .9; rp.style.transform = `translate(${p[1][0]}px,${p[1][1]}px) scale(${.3 + q})`; }
    }
    c.style.opacity = op;
    c.style.transform = `translate(${x - 8}px,${y - 4}px) scale(${sc})`;
  }
});

// ---------- الخلفية والحبيبات ----------
hook(t => {
  $('#g1').style.transform = `translate(${1000 + Math.sin(t * .23) * 220}px,${-200 + Math.cos(t * .19) * 120}px)`;
  $('#g2').style.transform = `translate(${80 + Math.cos(t * .17) * 200}px,${300 + Math.sin(t * .21) * 160}px)`;
  $('#g3').style.transform = `translate(${700 + Math.sin(t * .13 + 2) * 300}px,${680 + Math.cos(t * .11) * 100}px)`;
  const f = Math.floor(t * 30);
  $('#grain').style.transform = `translate(${(f * 37) % 200 - 100}px,${(f * 61) % 200 - 100}px)`;
});

// ---------- الأمزجة (بتلوّن الفيديو كله وقت مشهد 14) ----------
const MOODS = [
  { bg: '#15111C', solid: '#211B2C', raised: '#2B2439', ink: '#F6EEE3', ink2: '#D9CFE6', muted: '#A99CB8', accent: '#FF9466', accentInk: '#2A1206', accentHi: '#FFB48F', tb: '#130F1A', ga: '#FF9466', gb: '#B9A2FF', line2: '#3A3149' },
  { bg: '#0D1918', solid: '#16272A', raised: '#1E3538', ink: '#EAF6F1', ink2: '#C8E3DA', muted: '#8FB3AA', accent: '#6EE7C8', accentInk: '#0F2A23', accentHi: '#9BF0DA', tb: '#0B1615', ga: '#6EE7C8', gb: '#5E9DF5', line2: '#24403B' },
  { bg: '#19120F', solid: '#261C17', raised: '#33251E', ink: '#F8EEE2', ink2: '#E5D6C4', muted: '#B59F8C', accent: '#FFC56E', accentInk: '#2B1D05', accentHi: '#FFD99A', tb: '#140E0B', ga: '#FFB062', gb: '#FF7A5C', line2: '#3D2E26' },
  { bg: '#FBF3E8', solid: '#FFFFFF', raised: '#F4E9DA', ink: '#2A1F33', ink2: '#4A3D55', muted: '#6E5F78', accent: '#F2774A', accentInk: '#2A1206', accentHi: '#D9602F', tb: '#F6EBDD', ga: '#FFB38A', gb: '#C9B6FF', line2: '#EADCC8' },
];
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, p) => { const A = hex(a), B = hex(b); return `rgb(${A.map((x, i) => Math.round(lerp(x, B[i], p))).join(',')})`; };
const mixA = (a, b, p, al) => { const A = hex(a), B = hex(b); return `rgba(${A.map((x, i) => Math.round(lerp(x, B[i], p))).join(',')},${al})`; };
function applyMood(a, b, p) {
  const A = MOODS[a], B = MOODS[b], fr = $('#frame').style;
  const m = k => mix(A[k], B[k], p);
  fr.setProperty('--bg', m('bg')); fr.setProperty('--solid', m('solid')); fr.setProperty('--raised', m('raised'));
  fr.setProperty('--surface', mixA(A.solid, B.solid, p, lerp(a === 3 ? .8 : .74, b === 3 ? .8 : .74, p)));
  fr.setProperty('--field', mixA(A.bg, B.bg, p, .6));
  fr.setProperty('--ink', m('ink')); fr.setProperty('--ink-2', m('ink2')); fr.setProperty('--muted', m('muted'));
  fr.setProperty('--accent', m('accent')); fr.setProperty('--accent-ink', m('accentInk')); fr.setProperty('--accent-hi', m('accentHi'));
  fr.setProperty('--glow-a', m('ga')); fr.setProperty('--glow-b', m('gb')); fr.setProperty('--line-2', m('line2'));
  const lt = lerp(a === 3 ? 1 : 0, b === 3 ? 1 : 0, p);
  fr.setProperty('--line', lt > .5 ? 'rgba(42,31,51,.1)' : 'rgba(246,238,227,.10)');
  $('#mtb').style.background = m('tb');
  $('#vignette').style.opacity = 1 - lt * .7;
}

// =====================================================================
function build() {
  // بنظهر كل المشاهد وقت البناء عشان القياسات (offsetLeft وغيره) تبقى صح؛ seek بيخفيها تاني
  $$('.scene').forEach(s => { s.style.display = 'block'; });
  // --- 1: البداية (0–6) ---
  { const S = scene('s1', 0, 6);
  v('#s1 .logo', 'opacity', S, .5, 0, 1);
  v('#s1 .logo', '--s', S, 1.1, .3, 1, 'back');
  v('#s1 .logo', '--r', S, 1.1, -14, 0, 'out', 'deg');
  v('#s1 .sheen', '--sx', S + 1.1, .9, -200, 520, 'io', 'px');
  $$('#s1 .word span').forEach((el, i) => { v(el, 'opacity', S + 1 + i * .08, .4, 0, 1); v(el, '--y', S + 1 + i * .08, .7, 90, 0, 'back', 'px'); });
  inUp('#s1 .tag', S + 2, .5, 20);
  typeText('#s1tag', S + 2.2, 1.3, 'نتفرج على إيه الليلة؟');
  hook(t => { const c = $('#s1 .caret'); c.style.opacity = (t > 3.6 && Math.floor(t * 2.4) % 2) ? 0 : 1; });
  hook(t => { if (t < 6) $('#s1 .logo').style.translate = `0 ${Math.sin(t * 1.6) * 6}px`; });

  // --- 2: المشكلة (6–13) ---
  }
  { const S = scene('s2', 6, 13);
  const mess = $$('#s2 .mess');
  mess.forEach((el, i) => {
    const r = (i % 2 ? 1 : -1) * (4 + (i * 7) % 9);
    v(el, 'opacity', S + .2 + i * .17, .35, 0, 1);
    v(el, '--s', S + .2 + i * .17, .6, .4, 1, 'back');
    set(el, '--r', S, r + 'deg');
    const cx = el.offsetLeft + el.offsetWidth / 2, cy = el.offsetTop + el.offsetHeight / 2;
    v(el, '--x', S + 3.7 + i * .03, .8, 0, 960 - cx, 'in', 'px');
    v(el, '--y', S + 3.7 + i * .03, .8, 0, 405 - cy, 'in', 'px');
    v(el, '--s', S + 3.7 + i * .03, .8, 1, .05, 'in');
    v(el, 'opacity', S + 4.2 + i * .03, .35, 1, 0, 'lin');
  });
  hook(t => { if (t >= 6 && t < 13) mess.forEach((el, i) => { el.style.translate = `${Math.sin(t * 1.1 + i) * 10}px ${Math.cos(t * .9 + i * 2) * 12}px`; }); });
  inUp('#s2 .q', S + 1.1, .8, 40);
  v('#s2 .q', 'opacity', S + 3.5, .4, 1, 0, 'in');
  v('#s2 .q', '--s', S + 3.5, .4, 1, .9, 'in');
  pop('#s2 .mini', S + 4.45, .8, .2);
  v('#s2 .mini', '--r', S + 4.45, .8, -25, 0, 'back', 'deg');
  inUp('#s2 .ans', S + 5.0, .8, 30);

  // --- 3: الإضافة السريعة (13–23) ---
  }
  { const S = scene('s3', 13, 23);
  const rowsData = [
    ['Dark', '2017', 'مسلسل', '8.7'], ['The Dark Knight', '2008', 'فيلم', '9.0', 'in'],
    ['Dark Matter', '2024', 'مسلسل', '7.2'], ['Dark Waters', '2019', 'فيلم', '7.6'],
  ];
  const rows = $('#s3rows');
  rowsData.forEach(([n, y, ty, im, inl], i) => {
    const r = document.createElement('div');
    r.className = 'row a'; r.style.position = 'relative';
    r.appendChild(poster(n));
    r.insertAdjacentHTML('beforeend', `<div class="meta"><div class="t">${n}</div><div class="sub"><span>${y} · ${ty}</span><span class="badge imdb">IMDb ${im}</span></div></div>`
      + (inl ? `<div class="inlist">✔ في قايمتك</div>` : `<div class="acts${i === 0 ? ' a' : ''}" ${i === 0 ? 'id="s3acts"' : ''}><span class="btn acc" ${i === 0 ? 'id="s3want"' : ''}>هشوفه</span><span class="btn">شفته</span></div>`)
      + (i === 0 ? `<div class="added a" id="s3added"><span>✔ اتضاف</span><span class="btn">تراجع</span></div>` : ''));
    rows.appendChild(r);
  });
  inSide('#s3 .qa', S, .8, -90);
  caption('s3', S + .3);
  typeText('#s3type', S + 1.1, 1.0, 'Dark');
  hook(t => { if (t > 13 && t < 23) $('#s3 .search .caret').style.opacity = Math.floor(t * 2.4) % 2 ? 0 : 1; });
  inUp('#s3 .hdr', S + 2.1, .4, 10);
  inUp('#s3rows .row', S + 2.2, .55, 30, .12);
  cursor([[S + 3.2, [1300, 980]], [S + 4.3, '#s3want', 1], [S + 5.4, [900, 900]]]);
  outFade('#s3acts', S + 4.4, .2);
  v('#s3added', 'opacity', S + 4.5, .3, 0, 1); v('#s3added', '--s', S + 4.5, .5, .7, 1, 'back');
  set('#s3added', 'opacity', S, 0);
  v('#s3toast', 'opacity', S + 4.55, .3, 0, 1); v('#s3toast', '--y', S + 4.55, .5, 40, 0, 'back', 'px');
  set('#s3toast', 'opacity', S, 0);
  outFade('#s3toast', S + 7.2, .4);

  // --- 4: إضافة المتصفح (23–29) ---
  }
  { const S = scene('s4', 23, 29);
  mount('#s4poster', poster('Severance', 260, 385));
  inUp('#s4 .browser', S, .8, 50);
  caption('s4', S + .3);
  set('#s4panel', 'opacity', S, 0);
  v('#s4panel', 'opacity', S + 1.2, .4, 0, 1); v('#s4panel', '--y', S + 1.2, .6, 40, 0, 'back', 'px');
  cursor([[S + 1.6, [400, 950]], [S + 2.6, '#s4panel .am', 1], [S + 3.6, [300, 900]]]);
  set('#s4ok', 'opacity', S, 0);
  pop('#s4ok', S + 2.75, .5, .7);

  // --- 5: الشاشة الرئيسية (29–39) ---
  }
  { const S = scene('s5', 29, 39);
  mount('#hero1', poster('Dune: Part Two', 0, 0, 'bgp')).style.cssText = 'position:absolute;inset:0;border-radius:0;box-shadow:none';
  mount('#hero2', poster('Shōgun', 0, 0, 'bgp')).style.cssText = 'position:absolute;inset:0;border-radius:0;box-shadow:none';
  $$('#hero1 .pt,#hero2 .pt').forEach(e => e.remove());
  const cw = $('#cwRow');
  [['Dark', 'S01E05 · فاضل 6 من 10', 45], ['The Bear', 'S03E02 · وقفت عند 14:20', 30], ['Severance', 'S02E07 · فاضل 3 من 10', 70]].forEach(([n, s, w]) => {
    const c = document.createElement('div'); c.className = 'cwc glass';
    c.appendChild(poster(n));
    c.insertAdjacentHTML('beforeend', `<div style="flex:1"><b>${n}</b><small>${s}</small><div class="bar"><i style="width:${w}%"></i></div></div>`);
    cw.appendChild(c);
  });
  const grid = $('#homeGrid');
  ['Interstellar', 'Arcane', 'Oppenheimer', 'Parasite', 'Breaking Bad', 'Knives Out', 'Arrival'].forEach(n => grid.appendChild(poster(n, 210, 310)));
  v('#home', 'opacity', S, .8, 0, 1);
  v('#home', '--s', S, 10, .94, 1.0, 'out');
  v('#home', '--y', S, 1, 60, 0, 'out', 'px');
  set('#hero2', 'opacity', S, 0); set('#herotxt2', 'opacity', S, 0);
  v('#hero2', 'opacity', S + 3.9, 1.2, 0, 1, 'io');
  outFade('#herotxt1', S + 3.9, .5);
  inUp('#herotxt2', S + 4.4, .7, 20);
  hook(t => { if (t >= 29 && t < 39) { const two = t > S + 4.2; $('#dot1').className = two ? '' : 'on'; $('#dot2').className = two ? 'on' : ''; } });
  hook(t => { if (t >= 29 && t < 39) { const z = 1 + clamp((t - S) / 10) * .06; $('#hero1').style.transform = `scale(${z})`; $('#hero2').style.transform = `scale(${z})`; } });
  v('#homeIn', '--y', S + 6.0, 1.5, 0, -470, 'io', 'px');
  set('.callout', 'opacity', S, 0);
  pop('#co1', S + 1.3, .6, .7); outFade('#co1', S + 3.7, .3);
  pop('#co2', S + 2.6, .6, .7); outFade('#co2', S + 5.6, .3);
  pop('#co3', S + 7.6, .6, .7);

  // --- 6: الحالات والتقييم (39–46) ---
  }
  { const S = scene('s6', 39, 46);
  mount('#s6poster', poster('Arrival', 300, 445));
  const stars = $('#s6stars');
  for (let i = 0; i < 10; i++) stars.insertAdjacentHTML('beforeend', '<i>★</i>');
  inUp('#s6 .statusbar .pill', S + .2, .5, 20, .12);
  inSide('#s6 .det', S + .2, .8, -80);
  pop('#s6 .rates .badge', S + 1.0, .5, .5, .15);
  inUp('#s6 .filters .chip', S + 1.3, .45, 16, .07);
  caption('s6', S + .4);
  hook(t => {
    if (t < 39 || t >= 46) return;
    const r = t - S;
    const act = r < .9 ? -1 : r < 2.9 ? Math.floor((r - .9) / .5) % 4 : 2;
    $$('#s6 .statusbar .pill').forEach((p, i) => {
      p.style.background = i === act ? 'currentColor' : 'var(--surface)';
      p.style.setProperty('--s', i === act ? 1.08 : 1);
      p.firstElementChild.style.background = i === act ? '#1b1424' : 'currentColor';
      p.style.webkitTextFillColor = i === act ? '#1b1424' : '';
    });
    const n = Math.round(clamp((r - 1.6) / 1.0) * 9);
    $$('#s6stars i').forEach((s, i) => s.className = i < n ? 'on' : '');
  });
  typeText('#s6note', S + 2.8, 1.5, 'النهاية دي عملت فيا حاجة 🤯');

  // --- 7: البلاير (46–58) ---
  }
  { const S = scene('s7', 46, 58);
  mount('#s7vid', poster('Dark', 0, 0));
  inSide('#s7 .player', S, .8, -90);
  caption('s7', S + .3);
  inUp('#s7 .tracker', S + 1.0, .7, 30);
  set('#s7 .resume', 'opacity', S, 0);
  pop('#s7 .resume', S + .8, .5, .8); outFade('#s7 .resume', S + 2.6, .3);
  outFade('#s7 .bigplay', S + 1.4, .3);
  set('#s7 .sub', 'opacity', S, 0);
  v('#s7 .sub', 'opacity', S + 1.8, .3, 0, 1);
  cursor([[S + 1.4, [700, 700]], [S + 2.3, '#srv2', 1], [S + 3.1, [500, 600]], [S + 6.2, [500, 600]], [S + 6.9, '#s7next', 1], [S + 7.6, [900, 1000]]]);
  hook(t => {
    if (t < 46 || t >= 58) return;
    const r = t - S;
    const srvOn = r < 2.32 ? 1 : 2;
    $('#srv1').className = 'srv a' + (srvOn === 1 ? ' on' : ''); $('#srv2').className = 'srv a' + (srvOn === 2 ? ' on' : '');
    let w = r < 6.9 ? lerp(45, 93, EASE.io(clamp((r - 1.5) / 3.6))) : lerp(0, 12, clamp((r - 7.1) / 4));
    $('#s7tl').style.setProperty('--w', w + '%');
    const sec = Math.round(w / 100 * (51 * 60 + 24));
    $('#s7time').textContent = String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
    const e5 = r >= 4.9;
    $('#s7num').textContent = e5 ? 'S01 · E05' : 'S01 · E04';
    $('#s7ep').textContent = r >= 6.95 ? 'S01 · E05' : 'S01 · E04';
    $('#s7rem').textContent = e5 ? 'فاضل 6 من 10 في موسم 1' : 'فاضل 7 من 10 في موسم 1';
    $('#s7bar').style.width = lerp(30, 40, EASE.out(clamp((r - 4.9) / .6))) + '%';
  });
  set('#s7num', '--s', S, 1);
  v('#s7num', '--s', S + 4.9, .5, 1.35, 1, 'back');
  $('#s7num').classList.add('a'); $('#s7num').style.display = 'inline-block';
  set('#s7done', 'opacity', S, 0); set('#s7next', 'opacity', S, 0);
  pop('#s7done', S + 4.7, .5, .7);
  pop('#s7next', S + 5.5, .5, .7);
  outFade('#s7done', S + 7.4, .3); outFade('#s7next', S + 7.4, .3);

  // --- 8: موسم جديد (58–63) ---
  }
  { const S = scene('s8', 58, 63);
  mount('#s8poster', poster('The Bear', 420, 620));
  inSide('#s8 .ns-card', S, .8, -80);
  caption('s8', S + .3);
  set('#s8 .rib', 'opacity', S, 0);
  pop('#s8 .rib', S + 1.0, .6, .4);
  hook(t => { if (t >= 58 && t < 63) $('#s8 .rib').style.setProperty('--r', (t > S + 1.6 ? Math.sin((t - S) * 9) * 3 * Math.max(0, 1 - (t - S - 1.6) / 1.5) : 0) + 'deg'); });
  set('#s8 .wtoast', 'opacity', S, 0);
  v('#s8 .wtoast', 'opacity', S + 1.5, .3, 0, 1); v('#s8 .wtoast', '--x', S + 1.5, .7, 700, 0, 'out', 'px');

  // --- 9: Watch Party (63–75) ---
  }
  { const S = scene('s9', 63, 75);
  const code = 'K7Q2-M9XD', codeEl = $('#s9code');
  [...code].forEach(ch => codeEl.insertAdjacentHTML('beforeend', ch === '-' ? '<i class="dash">·</i>' : '<i class="cc"></i>'));
  const pool = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const real = code.replace('-', '');
  hook(t => {
    if (t < 63 || t >= 75) return;
    $$('#s9code .cc').forEach((el, i) => {
      const done = S + .7 + i * .09 + .4;
      el.textContent = t >= done ? real[i] : pool[(Math.floor(t * 20) * 7 + i * 13) % pool.length];
      el.style.color = t >= done ? 'var(--accent)' : 'var(--faint)';
    });
  });
  const avCols = ['#FF9466', '#6EE7C8', '#B9A2FF', '#FFD36E'];
  ['ج', 'م', 'س', 'ن'].forEach((ch, i) => $('#s9avs').insertAdjacentHTML('beforeend', `<div class="av a" style="background:${avCols[i]}">${ch}</div>`));
  pop('#s9avs .av', S + 1.6, .5, .3, .55);
  hook(t => { if (t >= 63 && t < 75) $('#s9n').textContent = `${1 + [1.6, 2.15, 2.7].filter(x => t >= S + x + .55).length} / 8`; });
  inUp('#s9 .room', S, .7, -30);
  $$('#s9 .s9p').forEach(h => h.replaceWith(Object.assign(poster('Interstellar'), { className: 'poster s9p' })));
  inUp('#s9 .screens .scr', S + .4, .7, 40, .15);
  caption('s9', S + .3);
  set('#s9 .s9ov', 'opacity', S, 0);
  v('#s9 .s9ov', 'opacity', S + 6.0, .25, 0, 1, 'lin');
  outFade('#s9 .s9ov', S + 8.0, .25);
  cursor([[S + 4.6, [700, 900]], [S + 5.9, [910, 540], 1], [S + 7.9, [910, 540], 1], [S + 8.6, [700, 1000]]]);
  hook(t => {
    if (t < 63 || t >= 75) return;
    const r = t - S;
    const playT = Math.min(r, 6) + Math.max(0, r - 8);
    $$('#s9 .s9w').forEach(el => el.style.setProperty('--w', (20 + playT * 3) + '%'));
    $$('#s9 .sd').forEach((d, i) => {
      const pulse = (r > 5.9 && r < 6.6) || (r > 7.9 && r < 8.6) ? 1 : 0;
      d.style.opacity = .25 + .75 * Math.max(0, Math.sin((t * 4 - i * .7) * Math.PI / 2)) * (pulse ? 1 : .5);
    });
  });
  set('#s9 .sync', 'opacity', S, 0); v('#s9 .sync', 'opacity', S + 1, .5, 0, 1);
  set('#s9 .weblink', 'opacity', S, 0);
  inUp('#s9 .weblink', S + 8.7, .7, 40);

  // --- 10: الذكاء الاصطناعي (75–86) ---
  }
  { const S = scene('s10', 75, 86);
  ['Claude', 'OpenAI', 'Gemini', 'Ollama', 'LM Studio', 'OpenRouter', 'Groq'].forEach(n => $('#s10prov').insertAdjacentHTML('beforeend', `<span class="chip a">${n}</span>`));
  inSide('#s10 .taste', S, .8, -80);
  caption('s10', S + .3);
  pop('#s10prov .chip', S + 1.1, .45, .5, .1);
  cursor([[S + 1.5, [800, 800]], [S + 2.4, '#s10btn', 1], [S + 3.2, [700, 900]]]);
  set('#s10think', 'opacity', S, 0);
  v('#s10think', 'opacity', S + 2.6, .3, 0, 1); outFade('#s10think', S + 4.3, .3);
  hook(t => { if (t >= 75 && t < 86) $$('#s10think .td').forEach((d, i) => d.style.transform = `translateY(${Math.min(0, Math.sin(t * 8 - i * .9)) * 10}px)`); });
  const picks = $('#s10picks');
  ['Blade Runner 2049', 'Annihilation', 'Coherence'].forEach(n => {
    const p = document.createElement('div'); p.className = 'pick a';
    p.appendChild(poster(n));
    p.insertAdjacentHTML('beforeend', `<b>${n}</b><div class="why">✨ اترشح ليه؟</div>`);
    picks.appendChild(p);
  });
  $$('#s10picks .pick').forEach((el, i) => {
    set(el, 'opacity', S, 0);
    v(el, 'opacity', S + 4.5 + i * .2, .4, 0, 1);
    v(el, '--y', S + 4.5 + i * .2, .7, 80, 0, 'back', 'px');
    v(el, '--r', S + 4.5 + i * .2, .7, (i - 1) * 6, 0, 'out', 'deg');
  });
  set('#s10 .whyp', 'opacity', S, 0);
  inUp('#s10 .whyp', S + 6.4, .6, 30);

  // --- 11: الفيلم الغامض (86–92) ---
  }
  { const S = scene('s11', 86, 92);
  mount('#s11poster', poster('Knives Out', 0, 0));
  inSide('#s11 .myst', S, .8, -80);
  caption('s11', S + .3);
  cursor([[S + 1.6, [900, 800]], [S + 2.7, '#s11btn', 1], [S + 3.4, [800, 900]]]);
  hook(t => {
    if (t < 86 || t >= 92) return;
    const r = t - S;
    const b = lerp(34, 0, EASE.io(clamp((r - 2.85) / .9)));
    $('#s11poster').style.filter = `blur(${b}px) saturate(${lerp(.4, 1, 1 - b / 34)})`;
    $('#s11poster .pt').style.opacity = clamp((r - 3.4) / .4);
    $('#s11 .top b').textContent = r < 3.3 ? 'فيلم غامض' : 'Knives Out';
    if (r < 2.8) $('#s11qm').style.setProperty('--s', 1 + Math.sin(t * 4) * .05);
  });
  v('#s11qm', 'opacity', S + 2.8, .35, 1, 0, 'in');
  v('#s11qm', '--s', S + 2.8, .35, 1, 1.6, 'in');

  // --- 12: الإحصائيات (92–100) ---
  }
  { const S = scene('s12', 92, 100);
  inUp('#s12 .statcap h2', S, .7, 30); inUp('#s12 .statcap p', S + .2, .7, 20);
  inUp('#s12 .kpi', S + .4, .6, 40, .12);
  hook(t => {
    if (t < 92 || t >= 100) return;
    const p = EASE.out(clamp((t - S - .8) / 1.6));
    $('#k1').textContent = Math.round(142 * p);
    $('#k2').innerHTML = (7.9 * p).toFixed(1) + '<span style="font-size:40px;color:var(--muted)">/10</span>';
    $('#k3').textContent = `${Math.round(62 * p)}٪ أفلام`;
    $('#k3').style.direction = 'rtl';
    $('#k3b').style.width = 62 * p + '%';
  });
  inUp('#s12 .chart', S + 1.3, .6, 40, .12);
  [['مايو', 9], ['يونيو', 14], ['يوليو', 11], ['أغسطس', 19], ['سبتمبر', 16], ['أكتوبر', 22]].forEach(([m, n]) =>
    $('#s12bars').insertAdjacentHTML('beforeend', `<div><i data-h="${n / 22 * 100}"></i><span>${m}</span></div>`));
  [['خيال علمي', 38], ['دراما', 31], ['جريمة', 22], ['إثارة', 18], ['كوميدي', 14], ['رعب', 9], ['أنيميشن', 8], ['وثائقي', 4]].forEach(([g, n]) =>
    $('#s12genres').insertAdjacentHTML('beforeend', `<span class="chip a" style="font-size:${Math.round(18 + n * .45)}px">${g} <span>${n}</span></span>`));
  [1, 2, 3, 6, 9, 17, 31, 38, 26, 11].forEach((n, i) => $('#s12hist').insertAdjacentHTML('beforeend', `<div><i data-h="${n / 38 * 100}"></i><span>${i + 1}</span></div>`));
  $$('#s12bars i, #s12hist i').forEach((el, i) => {
    const h = +el.dataset.h, st = S + 1.9 + (i % 10) * .07;
    tw(el, 'h', st, .8, (p, e) => { e.style.height = Math.max(2, h * .82 * p) + '%'; }, 'back');
  });
  pop('#s12genres .chip', S + 2.0, .45, .4, .08);

  // --- 13: التنزيلات (100–111) ---
  }
  { const S = scene('s13', 100, 111);
  pop('#s13ask', S, .7, .85);
  caption('s13', S + .3);
  cursor([[S + 1.3, [900, 900]], [S + 2.2, '#s13yes', 1], [S + 2.9, [800, 1000]]]);
  v('#s13ask', 'opacity', S + 2.45, .35, 1, 0, 'in'); v('#s13ask', '--s', S + 2.45, .35, 1, .9, 'in');
  set('#s13list', 'opacity', S, 0);
  inUp('#s13list', S + 2.65, .7, 40);
  hook(t => {
    if (t < 100 || t >= 111) return;
    const r = t - S;
    const p1 = EASE.io(clamp((r - 2.9) / 3.6));
    $('#d1').style.width = p1 * 100 + '%';
    $('#d1s').textContent = p1 >= 1 ? '✔ خلص' : Math.round(p1 * 100) + '%';
    $('#d1s').style.color = p1 >= 1 ? 'var(--watching)' : 'var(--ink)';
    if (p1 >= 1) $('#d1').style.background = 'var(--watching)';
    const p2 = clamp((r - 4.0) / 5);
    $('#d2').style.width = lerp(40, 82, p2) + '%';
    $('#d2s').textContent = r < 4.0 ? '⏸ متوقف' : `▶ ${Math.round(lerp(40, 82, p2))}%`;
  });
  set('#s13blk', 'opacity', S, 0);
  pop('#s13blk', S + 4.8, .5, .9);
  hook(t => { if (t >= 100 && t < 111) { const r = t - S - 5.0; $('#s13blk').style.translate = r > 0 && r < .5 ? `${Math.sin(r * 50) * 8 * (1 - r / .5)}px 0` : '0 0'; } });
  set('#s13 .adbox', 'opacity', S, 0);
  pop('#s13 .adbox', S + 6.2, .45, .6, .2);
  set('#s13 .shield', 'opacity', S, 0);
  inUp('#s13 .shield', S + 7.0, .6, 30);
  $$('#s13 .adbox').forEach((el, i) => {
    v(el, '--s', S + 7.6 + i * .15, .4, 1, .75, 'in');
    v(el, 'opacity', S + 7.6 + i * .15, .4, 1, 0, 'in');
    v(el, '--r', S + 7.6 + i * .15, .4, 0, i ? 12 : -12, 'in', 'deg');
  });

  // --- 14: الأمزجة (111–118) ---
  }
  { const S = scene('s14', 111, 118);
  mount('#mhero', poster('Interstellar', 0, 0)).style.cssText = 'position:absolute;inset:0;border-radius:0;box-shadow:none';
  $('#mhero .pt').remove();
  inUp('#s14 .moodcap h2', S, .7, 30); inUp('#s14 .moodcap p', S + .2, .7, 20);
  inUp('#mwin', S + .3, .8, 60);
  inUp('#s14 .mood', S + .6, .5, 20, .1);
  const seq = [[0, 0], [1.7, 1], [3.1, 2], [4.5, 3], [5.9, 0]];
  hook(t => {
    let a = 0, b = 0, p = 0;
    if (t >= S && t < 118) {
      const r = t - S;
      for (let i = 1; i < seq.length; i++) if (r >= seq[i][0]) { a = seq[i - 1][1]; b = seq[i][1]; p = EASE.io(clamp((r - seq[i][0]) / .5)); }
      $$('#s14 .mood').forEach((m, i) => {
        const on = i === (p > .5 ? b : a);
        m.style.borderColor = on ? 'var(--accent)' : 'transparent';
        m.style.background = on ? 'color-mix(in srgb,var(--accent) 16%,transparent)' : 'rgba(127,127,127,.08)';
        m.style.setProperty('--s', on ? 1.08 : 1);
      });
    }
    applyMood(a, b, p);
  });

  // --- 15: الأمان (118–124) ---
  }
  { const S = scene('s15', 118, 124);
  const icons = {
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    save: '<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v5h7V3M8 21v-6h8v6"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9m-4 4 3 3"/>',
    sync: '<path d="M20 11a8 8 0 0 0-14.5-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16m0 4v-4h-4"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="m9 12 2 2 4-4"/>',
    heart: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>',
  };
  [['lock', '#6EE7C8', 'بياناتك على جهازك', 'مفيش أكونت، ومفيش سيرفر بيشوف قايمتك'],
   ['save', '#FFD36E', 'نسخة احتياطية واسترجاع', 'وانقل إعداداتك لأي جهاز أو متصفح'],
   ['key', '#B9A2FF', 'مفاتيحك متشفّرة', 'مفتاح الـ AI بيتشفّر ومبيطلعش من البرنامج'],
   ['sync', '#FF9466', 'تحديثات لوحدها', 'بيدوّر كل 6 ساعات ويثبّت بدوسة واحدة'],
   ['shield', '#FF7A9A', 'مفيش popups', 'نوافذ الإعلانات المزعجة بتتقفل لوحدها'],
   ['heart', '#5E9DF5', 'بالمصري وببساطة', 'واجهة دافية وسهلة… زي قعدة صحاب'],
  ].forEach(([ic, c, b, s]) => $('#s15tiles').insertAdjacentHTML('beforeend',
    `<div class="tile glass a"><div class="ti" style="background:${c}22;color:${c}"><svg class="ic" viewBox="0 0 24 24">${icons[ic]}</svg></div><div><b>${b}</b><small>${s}</small></div></div>`));
  inUp('#s15 .statcap h2', S, .7, 30); inUp('#s15 .statcap p', S + .2, .7, 20);
  $$('#s15 .tile').forEach((el, i) => { v(el, 'opacity', S + .6 + i * .13, .4, 0, 1); v(el, '--y', S + .6 + i * .13, .6, 50, 0, 'back', 'px'); });

  // --- 16: النهاية (124–132) ---
  }
  { const S = scene('s16', 124, 132.5);
  pop('#s16 .logo', S + .2, 1, .3);
  v('#s16 .logo', '--r', S + .2, 1, 20, 0, 'back', 'deg');
  inUp('#s16 .word', S + .8, .8, 50);
  inUp('#s16 .sl', S + 1.3, .7, 30);
  pop('#s16 .cta', S + 1.9, .6, .7);
  inUp('#s16 .gh', S + 2.4, .6, 20);
  inUp('#s16 .os', S + 2.7, .6, 20);
  hook(t => { $('#frame').style.opacity = t > 130.6 ? clamp(1 - (t - 130.6) / 1.4) : 1; });
  }
}

function seek(t) {
  for (const arr of tracks.values()) {
    let cur = null;
    for (const x of arr) if (x.start <= t) cur = x;
    if (!cur) { arr[0].fn(arr[0].ease(0), arr[0].el); continue; }
    cur.fn(cur.ease(clamp((t - cur.start) / cur.dur)), cur.el);
  }
  for (const h of hooks) h(t);
}

window.DURATION = DURATION;
window.seek = seek;
window.ready = (async () => {
  await document.fonts.ready;
  await Promise.all($$('img').map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; })));
  build();
  resolveCursor();
  seek(0);
  return true;
})();

// معاينة في المتصفح: ?t=40 يبدأ من الثانية 40، و ?still يوقف
window.ready.then(() => {
  if (navigator.webdriver) return;
  const q = new URLSearchParams(location.search);
  let t0 = parseFloat(q.get('t') || '0');
  if (q.has('still')) { seek(t0); return; }
  const begin = performance.now();
  const loop = now => { const t = t0 + (now - begin) / 1000; seek(t % DURATION); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
});
