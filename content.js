// يقرأ بيانات الفيلم/المسلسل من صفحة IMDb ويعرض لوحة إضافة عائمة
(function () {
  const KEY = 'watchlist:data';
  let lastUrl = '';

  const decode = (s) => {
    const t = document.createElement('textarea');
    t.innerHTML = s || '';
    return t.value;
  };

  function readMeta() {
    // IMDb بتحط بيانات schema.org كاملة في JSON-LD
    const ld = document.querySelector('script[type="application/ld+json"]');
    if (!ld) return null;
    try {
      const d = JSON.parse(ld.textContent);
      const t = d['@type'] || '';
      if (!/Movie|TVSeries|TVMiniSeries/i.test(t)) return null;
      return {
        title: decode(d.name || d.alternateName || ''),
        type: /TV/i.test(t) ? 'tv' : 'film',
        year: d.datePublished ? parseInt(d.datePublished.slice(0, 4)) || null : null,
        genre: Array.isArray(d.genre) ? d.genre.join(', ') : (d.genre || ''),
        imdb: d.aggregateRating ? parseFloat(d.aggregateRating.ratingValue) || null : null,
        desc: decode(d.description || ''),
        poster: d.image || null,
        imdbID: (location.pathname.match(/\/title\/(tt\d+)/) || [])[1] || null
      };
    } catch (e) { return null; }
  }

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  async function addItem(meta, status) {
    const raw = (await chrome.storage.local.get(KEY))[KEY];
    let items = [];
    try { items = raw ? JSON.parse(raw) : []; } catch (e) { items = []; }

    const exists = items.find(i => i.title.toLowerCase() === meta.title.toLowerCase());
    if (exists) return { dup: true, item: exists };

    items.unshift({
      id: uid(), title: meta.title, type: meta.type, genre: meta.genre,
      status, rating: null, note: '', added: Date.now(),
      year: meta.year, imdb: meta.imdb, desc: meta.desc, poster: meta.poster,
      imdbID: meta.imdbID || null
    });
    await chrome.storage.local.set({ [KEY]: JSON.stringify(items) });
    return { dup: false };
  }

  function buildPanel(meta) {
    const old = document.getElementById('wl-panel');
    if (old) old.remove();

    const p = document.createElement('div');
    p.id = 'wl-panel';
    p.dir = 'rtl';
    p.innerHTML = `
      <div class="wl-head">
        <span class="wl-logo">🎟</span>
        <span class="wl-title">${meta.title.replace(/</g, '&lt;')}</span>
        <button class="wl-x" title="إخفاء">✕</button>
      </div>
      <div class="wl-sub">${meta.type === 'tv' ? 'مسلسل' : 'فيلم'}${meta.year ? ' • ' + meta.year : ''}${meta.imdb ? ' • ★ ' + meta.imdb : ''}</div>
      <div class="wl-btns">
        <button class="wl-btn wl-amber" data-s="queue">＋ هشوفه قريب</button>
        <button class="wl-btn" data-s="watched">✔ شفته خلاص</button>
      </div>
      <div class="wl-msg"></div>`;
    document.body.appendChild(p);

    const msg = p.querySelector('.wl-msg');
    p.querySelector('.wl-x').onclick = () => p.remove();
    p.querySelectorAll('.wl-btn').forEach(b => {
      b.onclick = async () => {
        b.disabled = true;
        const r = await addItem(meta, b.dataset.s);
        if (r.dup) {
          msg.textContent = 'موجود في قايمتك بالفعل ✋';
        } else {
          msg.textContent = b.dataset.s === 'queue'
            ? 'اتضاف لقايمة "هشوفهم" ✔'
            : 'اتضاف لـ"شفتهم" ✔ افتح القايمة وقيّمه';
          p.classList.add('wl-done');
          setTimeout(() => p.remove(), 3500);
        }
      };
    });
  }

  function tick() {
    if (location.href === lastUrl) return;
    // صفحات العناوين بس /title/ttXXXX
    if (!/\/title\/tt\d+/.test(location.pathname)) { lastUrl = location.href; return; }
    const meta = readMeta();
    if (meta && meta.title) {
      lastUrl = location.href;
      buildPanel(meta);
    }
  }

  tick();
  // IMDb بتتنقل بين الصفحات من غير reload أحياناً
  setInterval(tick, 1200);
})();
