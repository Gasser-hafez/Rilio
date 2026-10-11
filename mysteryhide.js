// وضع الميستري بوكس — يخفي كل حاجة في صفحة البلاير ما عدا الفيديو
// الموديل: بلور شامل + غطاء "ابدأ" بيرفعه المستخدم بنفسه، وبعدها الفيديو بس يبان
(function () {
  let active = false;

  function injectCss() {
    if (document.getElementById('wlm-style')) return;
    const s = document.createElement('style');
    s.id = 'wlm-style';
    s.textContent = `
      html.wlm-on img,
      html.wlm-on [style*="background-image"],
      html.wlm-on [class*="poster"i],
      html.wlm-on [class*="backdrop"i],
      html.wlm-on [class*="title"i],
      html.wlm-on [class*="name"i],
      html.wlm-on [class*="cover"i],
      html.wlm-on h1, html.wlm-on h2, html.wlm-on h3{
        filter:blur(34px)!important;color:transparent!important;text-shadow:none!important;
      }
      html.wlm-on video, html.wlm-on video *{filter:none!important;color:inherit!important}
      #wlm-veil{
        position:fixed;inset:0;z-index:2147483646;background:rgba(11,11,16,.97);
        display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px;
        color:#e8a33d;font-family:system-ui,'Segoe UI',Tahoma,sans-serif;text-align:center;padding:24px;
        transition:opacity .45s ease;
      }
      #wlm-veil .g{font-size:3.6rem;animation:wlmW 2s ease-in-out infinite;filter:drop-shadow(0 4px 12px rgba(0,0,0,.5))}
      #wlm-veil .t{font-size:1.2rem;font-weight:800}
      #wlm-veil .s{font-size:.84rem;color:#8d8b9c;max-width:340px;line-height:1.6}
      #wlm-veil button{
        margin-top:6px;background:#e8a33d;color:#161006;border:none;border-radius:11px;
        padding:13px 28px;font-weight:800;font-family:inherit;font-size:.95rem;cursor:pointer;
        box-shadow:0 4px 18px rgba(232,163,61,.45);transition:filter .15s,transform .1s;
      }
      #wlm-veil button:hover{filter:brightness(1.1)}
      #wlm-veil button:active{transform:translateY(1px)}
      @keyframes wlmW{0%,100%{transform:rotate(-7deg) scale(1)}50%{transform:rotate(7deg) scale(1.08)}}
    `;
    (document.head || document.documentElement).appendChild(s);
  }

  function markVideoSafe() {
    document.querySelectorAll('video').forEach((vid) => {
      let el = vid;
      while (el && el !== document.body && el.parentElement) {
        el.classList.add('wlm-safe');
        el = el.parentElement;
      }
    });
  }

  function makeVeil() {
    if (document.getElementById('wlm-veil') || !document.body) return;
    const v = document.createElement('div');
    v.id = 'wlm-veil';
    v.className = 'wlm-safe';
    v.innerHTML =
      '<div class="g">🎁</div>' +
      '<div class="t">فيلمك الغامض جاهز</div>' +
      '<div class="s">كل تفاصيل الفيلم مخفية عشان المفاجأة. أول ما تكون مستعد، اضغط وابدأ المشاهدة — الفيديو بس اللي هيبان.</div>' +
      '<button id="wlm-start">🍿 ابدأ المشاهدة</button>';
    document.body.appendChild(v);
    const btn = v.querySelector('#wlm-start');
    btn.onclick = () => {
      markVideoSafe();
      // شغّل الفيديو لو موجود على نفس الصفحة
      const vid = document.querySelector('video');
      if (vid) { try { vid.play(); } catch (e) {} }
      v.style.opacity = '0';
      setTimeout(() => v.remove(), 500);
    };
  }

  function activate() {
    if (active) return;
    active = true;
    injectCss();
    document.documentElement.classList.add('wlm-on');
    markVideoSafe();
    if (document.body) makeVeil();
    else {
      const bo = new MutationObserver(() => { if (document.body) { makeVeil(); bo.disconnect(); } });
      bo.observe(document.documentElement, { childList: true });
    }
    // كل ما يظهر فيديو جديد نأمّنه من البلور
    setInterval(markVideoSafe, 700);
    // مرّر الوضع للفريمات المتداخلة (الغطاء بيظهر في كل فريم فيه محتوى)
    setInterval(() => {
      for (let i = 0; i < window.frames.length; i++) {
        try { window.frames[i].postMessage({ __wlm: 1 }, '*'); } catch (e) {}
      }
    }, 800);
  }

  try { if (/wlmt=/.test(location.hash)) activate(); } catch (e) {}
  window.addEventListener('message', (e) => { if (e.data && e.data.__wlm) activate(); });
})();
