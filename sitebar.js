// شريط نوافذ المواقع — بيبعت أوامر بس (__wlBar من preload)، والحالة جاية من main. العنوان من الموقع: textContent بس
const $ = id => document.getElementById(id);
const mood = location.hash.slice(1);
if (/^(sahra|mint|coffee|sunrise)$/.test(mood)) document.documentElement.dataset.mood = mood;
for (const [id, cmd] of [['back', 'back'], ['fwd', 'fwd'], ['reload', 'reload']]) $(id).onclick = () => window.__wlBar.cmd(cmd);
window.__wlBar.onState(s => {
  $('back').disabled = !s.back;
  $('fwd').disabled = !s.fwd;
  $('reload').classList.toggle('loading', !!s.loading);
  $('title').textContent = s.title || '';
  $('host').textContent = s.host || '';
});
