/* ================= الحالة ================= */
const KEY='watchlist:data';
const DEFAULT_OMDB_KEY='4edf59c8';
const DEFAULT_SITES=[
  {name:'LordFlix', url:'https://lordflix.org/watch/{type}/{tmdbID}'},
  {name:'ShuttleTV', url:'https://shuttletv.pk/watch/{tmdbID}'}
];
const SEED=[
  {title:'The Boys',type:'tv',genre:'Superhero satire'},
  {title:'Silo',type:'tv',genre:'Dystopian sci-fi'},
  {title:'The Penguin',type:'tv',genre:'Crime drama'},
  {title:'Peaky Blinders',type:'tv',genre:'Crime drama'},
  {title:'Reacher',type:'tv',genre:'Action thriller'},
  {title:'Watchmen',type:'tv',genre:'Superhero drama'},
  {title:'The Revenant',type:'film',genre:'Survival drama'},
  {title:'Mad Max: Fury Road',type:'film',genre:'Post-apocalyptic action'},
  {title:'Legend',type:'film',genre:'Crime biopic'},
  {title:'The Irishman',type:'film',genre:'Crime epic'}
];
let items=[], sites=[], tab='queue', view='grid';
let sortDesc=true, queueSort='manual', editId=null, formStatus='queue', modalId=null;
let pendingMeta=null, selfWrites=0;
let filterType='all', filterGenre=null, statsOpen=false, impCands=[], playerOpen=false, genresOpen=false;
let mysteryMode=false, mysteryId=null;
const DEFAULT_PLAYER='https://vidsrc-embed.ru/embed/{type}?tmdb={tmdbID}&season={season}&episode={episode}';
const PLAYER_SERVERS=[
  {name:'سيرفر 1', tpl:'https://vsembed.ru/embed/{type}?tmdb={tmdbID}&season={season}&episode={episode}'},
  {name:'سيرفر 2', tpl:'https://vidsrc.cc/v2/embed/{type}/{tmdbID}/{season}/{episode}'},
  {name:'سيرفر 3', tpl:'https://player.embed-api.stream/?id={tmdbID}&s={season}&e={episode}'}
];
let playerSrv=0, playerShield=true, subLang='ar';
const DEFAULT_DL='https://web.nxsha.app/dl/{type}/{tmdbID}';

/* ================= أدوات ================= */
const $=id=>document.getElementById(id);
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,6);
const esc=s=>(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sget=async k=>(await chrome.storage.local.get(k))[k];
const sset=async(k,v)=>chrome.storage.local.set({[k]:v});
function toast(msg){
  const t=$('toast');t.textContent=msg;t.classList.add('show');
  clearTimeout(t._h);t._h=setTimeout(()=>t.classList.remove('show'),2200);
}

/* ================= تنضيف البيانات =================
   البيانات ممكن تيجي من نسخة احتياطية أو ملف إعدادات حد بعتهولك، وكتير من الحقول دي بتتحط في HTML من غير esc
   فبنضمن نوعها هنا مرة واحدة عند القراية بدل ما نأمّن كل مكان بيعرضها */
const STATUSES=['queue','watching','watched','dropped'];
const isHttp=u=>typeof u==='string'&&/^https?:\/\//i.test(u);
const num=v=>(v==null||v==='')?null:(Number.isFinite(+v)?+v:null);
const str=v=>typeof v==='string'?v:'';
function cleanItem(it){
  if(!it||typeof it!=='object'||!str(it.title).trim())return null;
  const out={...it};
  if(!/^[\w-]{1,40}$/.test(str(it.id)))out.id=uid();
  out.title=str(it.title);out.genre=str(it.genre);out.note=str(it.note);out.desc=str(it.desc);
  out.type=it.type==='tv'?'tv':'film';
  out.status=STATUSES.includes(it.status)?it.status:'queue';
  for(const k of ['rating','year','imdb','tmdbId','curSeason','curEp','added','order','watchedAt','totalSeasons','latestSeasons','lastKnownSeasons'])
    out[k]=num(it[k]);
  out.imdbID=/^tt\d+$/.test(str(it.imdbID))?it.imdbID:null;
  out.poster=isHttp(it.poster)?it.poster:null;
  // backdrop مسار TMDB زي /abc.jpg، و'' معناها "جربنا وملقيناش"
  out.backdrop=it.backdrop===''?'':/^\/[\w.-]+$/.test(str(it.backdrop))?it.backdrop:null;
  out.newSeason=it.newSeason===true;
  // سبب الترشيح (لو جه من الـ AI) — undefined بيتشال من الـ JSON فالعناصر العادية متكبرش
  out.recWhy=str(it.recWhy).slice(0,300)||undefined;
  out.recFrom=Array.isArray(it.recFrom)?it.recFrom.filter(t=>typeof t==='string'&&t).slice(0,5).map(t=>t.slice(0,120)):[];
  if(!out.recFrom.length)out.recFrom=undefined;
  if(it.seasonEps&&typeof it.seasonEps==='object'){
    out.seasonEps={};
    for(const [s,n] of Object.entries(it.seasonEps))if(/^\d+$/.test(s)&&num(n)!=null)out.seasonEps[s]=num(n);
  }else delete out.seasonEps;
  return out;
}
function parseItems(raw){
  const arr=JSON.parse(raw||'[]');
  return Array.isArray(arr)?arr.map(cleanItem).filter(Boolean):[];
}
function parseSites(raw){
  const arr=JSON.parse(raw);
  return Array.isArray(arr)?arr.filter(s=>s&&isHttp(s.url)).map(s=>({name:str(s.name)||s.url,url:s.url})):null;
}

/* ================= التخزين ================= */
async function persist(){
  // عناصر الـ Watch Party المؤقتة (_party) مبتتحفظش
  try{selfWrites++;await sset(KEY,JSON.stringify(items.filter(i=>!i._party)));}
  catch(e){selfWrites--;toast('⚠ فشل الحفظ — جرب تاني');}
}
chrome.storage.onChanged.addListener((ch,area)=>{
  if(area==='local'&&ch[KEY]){
    if(selfWrites>0){selfWrites--;return;} // كتابتنا إحنا
    try{items=parseItems(ch[KEY].newValue);render();if(modalId)renderModal();}catch(e){}
  }
});
async function seedOnce(){
  if(await sget('watchlist:seeded'))return;
  const have=new Set(items.map(i=>i.title.toLowerCase()));
  SEED.forEach(s=>{
    if(!have.has(s.title.toLowerCase()))
      items.push({id:uid(),title:s.title,type:s.type,genre:s.genre,status:'watched',rating:9,note:'',added:Date.now()});
  });
  await sset('watchlist:seeded','1');
  await persist();
}
async function load(){
  try{items=parseItems(await sget(KEY));}
  catch(e){items=[];}
  await seedOnce();
  $('apiKey').value=(await sget('watchlist:omdbkey'))||DEFAULT_OMDB_KEY;
  $('tmdbKey').value=(await sget('watchlist:tmdbkey'))||'';
  $('playerTpl').value=(await sget('watchlist:playerTpl'))||DEFAULT_PLAYER;
  $('dlTpl').value=(await sget('watchlist:dlTpl'))||DEFAULT_DL;
  playerSrv=parseInt((await sget('watchlist:playerSrv'))||'0')||0;
  playerShield=(await sget('watchlist:playerShield'))==='1';
  subLang=(await sget('watchlist:subLang'));if(subLang==null)subLang='ar';
  applyTheme((await sget('watchlist:theme'))||'cinema');
  view=(await sget('watchlist:view'))||'grid';
  try{const s=await sget('watchlist:sites');sites=s?parseSites(s):null;}catch(e){sites=null;}
  if(!sites){sites=DEFAULT_SITES.slice();await sset('watchlist:sites',JSON.stringify(sites));}
  statsOpen=(await sget('watchlist:statsOpen'))==='1';
  renderSites();
  render();
  aiLoad();
  checkSeasons();
  checkBackupDue();
}
async function checkBackupDue(){
  const now=Date.now(), day=24*3600*1000;
  let inst=parseInt((await sget('watchlist:installedAt'))||'0');
  if(!inst){inst=now;await sset('watchlist:installedAt',String(now));}
  const lastBk=parseInt((await sget('watchlist:lastBackup'))||'0');
  const snooze=parseInt((await sget('watchlist:backupSnooze'))||'0');
  const ref=Math.max(lastBk,inst);
  if(items.length&&now-ref>14*day&&now-snooze>3*day)$('bkBanner').style.display='flex';
}
async function bkSnooze(){
  await sset('watchlist:backupSnooze',String(Date.now()));
  $('bkBanner').style.display='none';
}

/* ================= الثيمات ================= */
function applyTheme(t){
  if(t==='cinema')delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme=t;
  document.querySelectorAll('.theme-card').forEach(c=>c.classList.toggle('on',(c.dataset.v||'cinema')===t));
}
async function setTheme(t){
  applyTheme(t);
  await sset('watchlist:theme',t);
  render(); // تبديل الـ layout بين الحائط ووضع المنصات
  toast('الثيم اتغيّر ✔');
}

/* ================= مودال الإعدادات ================= */
function openSettings(){
  shieldLabel();
  document.querySelectorAll('#subLangs .sl').forEach(b=>b.classList.toggle('on',b.dataset.v===(subLang||'ar')));
  document.querySelectorAll('.theme-card').forEach(c=>c.classList.toggle('on',(document.documentElement.dataset.theme||'cinema')===c.dataset.v));
  $('settingsOverlay').classList.add('show');
}
function closeSettings(){$('settingsOverlay').classList.remove('show');}
$('settingsOverlay').addEventListener('click',e=>{if(e.target===$('settingsOverlay'))closeSettings();});

/* ================= المواسم الجديدة ================= */
/* ================= فحص المواسم الجديدة =================
   بيشتغل عند الفتح وكل ساعة (والفحص الفعلي كل 6 ساعات) — في الديسكتوب النافذة عايشة في الـ tray فده شغال في الخلفية */
const SEASON_CHECK_EVERY=6*3600*1000;
let seasonCheckRunning=false;
// آخر موسم نزل فعلاً — number_of_seasons بيزيد أول ما الموسم يتعلن حتى لو لسه فاضل عليه شهور
function airedSeasons(d){
  const today=new Date().toISOString().slice(0,10);
  return (d.seasons||[]).reduce((m,s)=>
    (s.season_number>0&&s.air_date&&s.air_date<=today)?Math.max(m,s.season_number):m,0);
}
// إشعار ويندوز — موجود في الديسكتوب بس؛ في الاكستنشن الجرس على الكارت كفاية
function notifyDesktop(p){
  if(window.__wlDesktop)return window.__wlDesktop.notify(p).catch(()=>{});
}
async function checkSeasons(){
  if(seasonCheckRunning)return;
  const tok=(await sget('watchlist:tmdbkey'))||'';
  if(!tok)return;
  const last=parseInt((await sget('watchlist:lastSeasonCheck'))||'0');
  if(Date.now()-last<SEASON_CHECK_EVERY)return;
  seasonCheckRunning=true;
  try{
    const shows=items.filter(i=>i.type==='tv'&&(i.status==='watched'||i.status==='watching'));
    let changed=false, ok=0;
    const fresh=[];
    for(const it of shows){
      try{
        const tid=await resolveTmdb(it);
        const d=await tmdbFetch(`/tv/${tid}`);
        ok++;
        const n=airedSeasons(d);
        if(it.latestSeasons!==n){it.latestSeasons=n;changed=true;}
        if(d.backdrop_path&&!it.backdrop){it.backdrop=d.backdrop_path;changed=true;}
        // بيانات قديمة اتحسبت بالمواسم المعلنة — نرجّعها للي نزل فعلاً عشان الإشعار ييجي لما الموسم ينزل
        if(it.lastKnownSeasons==null||it.lastKnownSeasons>n){it.lastKnownSeasons=n;changed=true;}
        else if(n>it.lastKnownSeasons&&!it.newSeason){it.newSeason=true;changed=true;fresh.push(it);}
      }catch(e){if(e.message==='NO_KEY'||e.message==='BAD_KEY')break;}
    }
    // لو كله فشل (مفيش نت) منسجلش إننا فحصنا — نحاول تاني الساعة الجاية
    if(ok||!shows.length)await sset('watchlist:lastSeasonCheck',String(Date.now()));
    if(changed){await persist();render();}
    if(fresh.length===1){
      const it=fresh[0];
      notifyDesktop({title:'🔔 موسم جديد نزل',body:`${it.title} — الموسم ${it.latestSeasons}`,itemId:it.id});
    }else if(fresh.length>1){
      notifyDesktop({title:`🔔 ${fresh.length} مسلسلات نزلها مواسم جديدة`,body:fresh.map(i=>i.title).join('، ')});
    }
  }finally{seasonCheckRunning=false;}
}
setInterval(checkSeasons,3600*1000);
if(window.__wlDesktop)window.__wlDesktop.onOpenItem(id=>{if(items.some(i=>i.id===id))openModal(id);});
async function ackSeason(id){
  const it=items.find(i=>i.id===id);if(!it)return;
  it.lastKnownSeasons=it.latestSeasons||it.lastKnownSeasons;
  it.newSeason=false;
  await persist();render();if(modalId)renderModal();
}

/* ================= الفورم ================= */
document.querySelectorAll('#statusSeg button').forEach(b=>{
  b.onclick=()=>{
    formStatus=b.dataset.s;
    document.querySelectorAll('#statusSeg button').forEach(x=>x.classList.toggle('on',x===b));
  };
});

$('saveBtn').onclick=async()=>{
  const title=$('fTitle').value.trim();
  if(!title){toast('اكتب الاسم الأول');$('fTitle').focus();return;}
  const type=$('fType').value, genre=$('fGenre').value.trim();
  if(editId){
    const it=items.find(i=>i.id===editId);
    if(it){it.title=title;it.type=type;it.genre=genre;
      if(pendingMeta){it.year=pendingMeta.year;it.imdb=pendingMeta.imdb;it.desc=pendingMeta.desc||'';it.poster=pendingMeta.poster||null;it.imdbID=pendingMeta.imdbID||it.imdbID||null;it.tmdbId=null;it.backdrop=null;}
      if(it.status!==formStatus){it.status=formStatus;if(formStatus==='queue'){it.rating=null;it.note='';}}
    }
    editId=null;toast('اتعدل ✔');
  }else{
    const it={id:uid(),title,type,genre,status:formStatus,rating:null,note:'',added:Date.now(),order:Date.now(),
      year:pendingMeta?pendingMeta.year:null,imdb:pendingMeta?pendingMeta.imdb:null,
      desc:pendingMeta?pendingMeta.desc||'':'',poster:pendingMeta?pendingMeta.poster||null:null,
      imdbID:pendingMeta?pendingMeta.imdbID||null:null};
    items.unshift(it);
    if(formStatus==='watched')modalId=it.id;
    toast('اتضاف ✔');
  }
  await persist();resetForm();tab=formStatus;render();
  if(modalId)openModal(modalId);
};

$('cancelEdit').onclick=()=>{editId=null;resetForm();};

function resetForm(){
  $('fTitle').value='';$('fGenre').value='';$('fType').value='film';
  formStatus='queue';pendingMeta=null;$('metaPreview').textContent='';hideChooser();
  document.querySelectorAll('#statusSeg button').forEach(x=>x.classList.toggle('on',x.dataset.s==='queue'));
  $('formTitle').textContent='＋ إضافة جديد';
  $('saveBtn').textContent='حفظ';
  $('cancelEdit').style.display='none';
  $('addBox').open=false;
}

function startEdit(id){
  const it=items.find(i=>i.id===id);if(!it)return;
  closeModal();
  editId=id;
  $('fTitle').value=it.title;$('fType').value=it.type;$('fGenre').value=it.genre||'';
  pendingMeta=(it.year||it.imdb||it.desc||it.poster)?{year:it.year||null,imdb:it.imdb||null,desc:it.desc||'',poster:it.poster||null,imdbID:it.imdbID||null}:null;
  $('metaPreview').textContent=pendingMeta?`✔ ${it.year||'؟'} • IMDb ★ ${it.imdb||'؟'}`:'';
  formStatus=it.status==='dropped'?'queue':it.status;
  document.querySelectorAll('#statusSeg button').forEach(x=>x.classList.toggle('on',x.dataset.s===formStatus));
  $('formTitle').textContent='✎ تعديل: '+it.title;
  $('saveBtn').textContent='حفظ التعديل';
  $('cancelEdit').style.display='';
  $('addBox').open=true;
  window.scrollTo({top:0,behavior:'smooth'});
}

/* ================= بحث OMDb للإضافة اليدوية ================= */
$('lookupBtn').onclick=async()=>{
  const title=$('fTitle').value.trim();
  if(!title){toast('اكتب الاسم الأول');$('fTitle').focus();return;}
  const key=(await sget('watchlist:omdbkey'))||DEFAULT_OMDB_KEY;
  const btn=$('lookupBtn');
  btn.disabled=true;btn.textContent='⏳ ...';
  $('metaPreview').textContent='بدور على البيانات...';
  hideChooser();
  try{
    const res=await fetch(`https://www.omdbapi.com/?apikey=${encodeURIComponent(key)}&s=${encodeURIComponent(title)}`);
    const data=await res.json();
    if(data.Response!=='True')throw new Error(data.Error||'not found');
    const results=(data.Search||[]).filter(r=>r.Type==='movie'||r.Type==='series').slice(0,6);
    if(!results.length)throw new Error('not found');
    if(results.length===1){
      await pickResult(results[0].imdbID,key);
    }else{
      $('metaPreview').textContent='لقيت أكتر من نتيجة — اختار الصح:';
      const ch=$('chooser');
      ch.innerHTML=results.map(r=>
        `<button type="button" class="btn btn-sm" style="text-align:start" data-act="pick" data-imdb="${r.imdbID}">`+
        `<span dir="ltr">${esc(r.Title)} (${esc(r.Year)})</span> — ${r.Type==='series'?'مسلسل':'فيلم'}</button>`).join('');
      ch.style.display='flex';
    }
  }catch(e){
    pendingMeta=null;
    $('metaPreview').textContent='';
    toast(e.message==='Invalid API key!'?'مفتاح OMDb غلط أو لسه متفعّلش — بص على إيميل التفعيل':'ملقتش حاجة بالاسم ده — جرب تكتبه أدق');
  }
  btn.disabled=false;btn.textContent='🔍 IMDb';
};

function hideChooser(){const ch=$('chooser');ch.style.display='none';ch.innerHTML='';}

async function pickResult(imdbID,key){
  key=key||(await sget('watchlist:omdbkey'))||DEFAULT_OMDB_KEY;
  $('metaPreview').textContent='بجيب التفاصيل...';
  hideChooser();
  try{
    const res=await fetch(`https://www.omdbapi.com/?apikey=${encodeURIComponent(key)}&i=${encodeURIComponent(imdbID)}&plot=short`);
    const meta=await res.json();
    if(meta.Response!=='True')throw new Error(meta.Error||'not found');
    const year=parseInt((meta.Year||'').slice(0,4))||null;
    const imdb=parseFloat(meta.imdbRating)||null;
    pendingMeta={
      year, imdb,
      desc:(meta.Plot&&meta.Plot!=='N/A')?meta.Plot:'',
      poster:(meta.Poster&&meta.Poster!=='N/A')?meta.Poster:null,
      imdbID:meta.imdbID||imdbID||null
    };
    if(meta.Title)$('fTitle').value=meta.Title;
    $('fType').value=meta.Type==='series'?'tv':'film';
    if(meta.Genre&&meta.Genre!=='N/A'&&!$('fGenre').value.trim())$('fGenre').value=meta.Genre;
    $('metaPreview').textContent=`✔ ${year||'؟'} • IMDb ★ ${imdb||'؟'}${pendingMeta.desc?' • '+pendingMeta.desc.slice(0,80)+'…':''}`;
    toast('البيانات اتجابت ✔');
  }catch(e){
    pendingMeta=null;
    $('metaPreview').textContent='';
    toast('حصلت مشكلة في جلب التفاصيل — جرب تاني');
  }
}

/* ================= الشريط ================= */
document.querySelectorAll('.tab').forEach(b=>{
  b.onclick=()=>{tab=b.dataset.tab;filterGenre=null;render();};
});
$('gearBtn').onclick=openSettings;
$('statsToggle').onclick=()=>{openStats();};
$('search').oninput=()=>render();

$('viewBtn').onclick=async()=>{
  view=view==='grid'?'list':'grid';
  await sset('watchlist:view',view);
  render();
};

$('randBtn').onclick=()=>{
  const pool=items.filter(i=>i.status==='queue');
  if(!pool.length){toast('قايمة "هشوفهم" فاضية');return;}
  const weights=pool.map(i=>Math.pow(i.imdb||6,2)); // الأعلى على IMDb فرصته أكبر
  const tot=weights.reduce((a,b)=>a+b,0);
  let r=Math.random()*tot,pick=pool[0];
  for(let j=0;j<pool.length;j++){r-=weights[j];if(r<=0){pick=pool[j];break;}}
  render();
  const el=document.querySelector(`[data-itemid="${pick.id}"]`);
  if(el){
    el.scrollIntoView({behavior:'smooth',block:'center'});
    el.classList.add('picked');
    setTimeout(()=>el.classList.remove('picked'),2500);
  }
  toast('🎲 '+pick.title);
};

$('sortBtn').onclick=()=>{
  if(tab==='watched'){sortDesc=!sortDesc;}
  else{queueSort=queueSort==='manual'?'added':queueSort==='added'?'imdbDesc':queueSort==='imdbDesc'?'imdbAsc':'manual';}
  render();
};

/* ================= الإحصائيات ================= */
function renderStats(){
  const bar=$('statsBar');
  if(!bar)return;
  bar.style.display='none';
  return;
  if(!statsOpen)return;
  const w=items.filter(i=>i.status==='watched');
  const films=w.filter(i=>i.type==='film').length, tv=w.filter(i=>i.type==='tv').length;
  const rated=w.filter(i=>i.rating);
  const avg=rated.length?(rated.reduce((a,b)=>a+b.rating,0)/rated.length).toFixed(1):'—';
  const g={};w.forEach(i=>(i.genre||'').split(',').map(x=>x.trim()).filter(Boolean).forEach(x=>g[x]=(g[x]||0)+1));
  const top=Object.entries(g).sort((a,b)=>b[1]-a[1])[0];
  const hours=films*2+tv*12; // تقدير: فيلم ~ساعتين، مسلسل ~12 ساعة
  bar.innerHTML=`<span>🎬 ${films} فيلم</span><span>📺 ${tv} مسلسل</span><span>★ متوسط تقييمك ${avg}</span>${top?`<span>🏷 أكتر نوع: ${esc(top[0])} (${top[1]})</span>`:''}<span>⏱ ~${hours} ساعة مشاهدة</span>`;
}

/* ================= لوحة الإحصائيات والرؤى ================= */
function openStats(){buildStats();$('statsOverlay').classList.add('show');}
function closeStats(){$('statsOverlay').classList.remove('show');}
$('statsOverlay').addEventListener('click',e=>{if(e.target===$('statsOverlay'))closeStats();});

function buildStats(){
  const all=items;
  const watched=all.filter(i=>i.status==='watched');
  const rated=watched.filter(i=>i.rating);
  const films=all.filter(i=>i.type==='film');
  const tv=all.filter(i=>i.type==='tv');
  const wFilms=watched.filter(i=>i.type==='film').length;
  const wTv=watched.filter(i=>i.type==='tv').length;
  const avg=rated.length?(rated.reduce((a,b)=>a+b.rating,0)/rated.length):0;
  const hours=wFilms*2+wTv*12;

  // مقدمة شخصية
  let intro='لسه بدري — قيّم شوية أفلام وشوف ذوقك بيتشكّل.';
  if(rated.length>=3){
    const topG=genreCounts(watched)[0];
    intro=`شفت ${watched.length} حاجة، متوسط تقييمك ${avg.toFixed(1)}/10`+(topG?`، وأكتر حاجة بتنجذب ليها ${esc(topG[0])}.`:'.');
  }
  $('statsIntro').textContent=intro;

  let html='';
  // كروت سريعة
  html+=`<div class="stat-cards">
    <div class="stat-card"><div class="sc-num">${watched.length}</div><div class="sc-lab">اتفرجت عليها</div></div>
    <div class="stat-card"><div class="sc-num">${all.filter(i=>i.status==='queue').length}</div><div class="sc-lab">في قايمة الانتظار</div></div>
    <div class="stat-card"><div class="sc-num">${avg?avg.toFixed(1):'—'}</div><div class="sc-lab">متوسط تقييمك</div></div>
    <div class="stat-card"><div class="sc-num">~${hours}</div><div class="sc-lab">ساعة مشاهدة</div></div>
  </div>`;

  // توزيع التقييمات
  if(rated.length){
    const dist={};for(let n=1;n<=10;n++)dist[n]=0;
    rated.forEach(i=>dist[i.rating]=(dist[i.rating]||0)+1);
    const maxD=Math.max(...Object.values(dist));
    html+=`<div class="stat-sec"><h3>⭐ توزيع تقييماتك</h3><div class="rating-bars">`;
    for(let n=1;n<=10;n++){
      const c=dist[n],h=maxD?Math.round(c/maxD*100):0;
      html+=`<div class="rb"><div class="rb-fill" style="height:${h}%">${c?`<span class="rb-c">${c}</span>`:''}</div><div class="rb-x">${n}</div></div>`;
    }
    html+=`</div></div>`;
  }

  // أفلام مقابل مسلسلات
  const totFT=films.length+tv.length;
  if(totFT){
    const fPct=Math.round(films.length/totFT*100);
    html+=`<div class="stat-sec"><h3>🎬 أفلام مقابل مسلسلات</h3>
      <div class="gbar"><div class="gbar-top"><span class="gname">🎬 أفلام</span><span class="gcount">${films.length} (${fPct}%)</span></div><div class="gbar-track"><div class="gbar-fill" style="width:${fPct}%"></div></div></div>
      <div class="gbar"><div class="gbar-top"><span class="gname">📺 مسلسلات</span><span class="gcount">${tv.length} (${100-fPct}%)</span></div><div class="gbar-track"><div class="gbar-fill" style="width:${100-fPct}%"></div></div></div>
    </div>`;
  }

  // أكتر التصنيفات (من كل القايمة)
  const gc=genreCounts(all).slice(0,6);
  if(gc.length){
    const maxG=gc[0][1];
    html+=`<div class="stat-sec"><h3>🏷 التصنيفات اللي بتحبها</h3>`;
    gc.forEach(([name,c])=>{
      html+=`<div class="gbar"><div class="gbar-top"><span class="gname">${esc(name)}</span><span class="gcount">${c}</span></div><div class="gbar-track"><div class="gbar-fill" style="width:${Math.round(c/maxG*100)}%"></div></div></div>`;
    });
    html+=`</div>`;
  }

  // نشاط آخر ٦ شهور
  const now=new Date();
  const months=[];
  for(let k=5;k>=0;k--){const d=new Date(now.getFullYear(),now.getMonth()-k,1);months.push({y:d.getFullYear(),m:d.getMonth(),c:0});}
  watched.forEach(i=>{const t=i.watchedAt||i.added;if(!t)return;const d=new Date(t);const slot=months.find(x=>x.y===d.getFullYear()&&x.m===d.getMonth());if(slot)slot.c++;});
  const maxM=Math.max(1,...months.map(x=>x.c));
  const monthNames=['ينا','فبر','مار','أبر','ماي','يون','يول','أغس','سبت','أكت','نوف','ديس'];
  if(watched.length){
    html+=`<div class="stat-sec"><h3>📅 نشاطك آخر ٦ شهور</h3><div class="month-grid">`;
    months.forEach(x=>{html+=`<div class="mo"><div class="mo-fill" style="height:${Math.round(x.c/maxM*100)}%" title="${x.c}"></div><div class="mo-x">${monthNames[x.m]}</div></div>`;});
    html+=`</div></div>`;
  }

  $('statsContent').innerHTML=html;
}
function genreCounts(list){
  const g={};
  list.forEach(i=>(i.genre||'').split(',').map(x=>x.trim()).filter(Boolean).forEach(x=>g[x]=(g[x]||0)+1));
  return Object.entries(g).sort((a,b)=>b[1]-a[1]);
}

/* ================= شرائح الفلترة ================= */
function renderChips(tabRows){
  const g={};tabRows.forEach(i=>(i.genre||'').split(',').map(x=>x.trim()).filter(Boolean).forEach(x=>g[x]=(g[x]||0)+1));
  const top=Object.entries(g).sort((a,b)=>b[1]-a[1]).slice(0,8);
  let html=`<button class="fchip ${filterType==='all'?'on':''}" data-act="fType" data-v="all">الكل</button>
    <button class="fchip ${filterType==='film'?'on':''}" data-act="fType" data-v="film">أفلام</button>
    <button class="fchip ${filterType==='tv'?'on':''}" data-act="fType" data-v="tv">مسلسلات</button>`;
  if(top.length){
    html+=`<span class="fsep"></span><button class="fchip ${genresOpen||filterGenre?'on':''}" data-act="fMore">تصنيفات ${genresOpen?'▴':'▾'}</button>`;
    if(genresOpen||filterGenre)html+=top.map(([name,c])=>`<button class="fchip ${filterGenre===name?'on':''}" data-act="fGenre" data-v="${esc(name)}">${esc(name)} <span style="opacity:.6">${c}</span></button>`).join('');
  }
  $('chips').innerHTML=tabRows.length?html:'';
}

/* ================= العرض ================= */
function stampClass(r){return r>=7?'hi':r>=5?'mid':'lo';}
function stampHtml(it){
  if(it.status==='watched'&&it.rating)return `<div class="stamp ${stampClass(it.rating)}">${it.rating}</div>`;
  if(it.status==='watched')return `<div class="stamp q">?</div>`;
  if(it.status==='dropped')return `<div class="stamp drop">✖</div>`;
  if(it.status==='watching')return `<div class="stamp mid q">▶</div>`;
  return `<div class="stamp q">▶</div>`;
}
const pad=n=>String(n).padStart(2,'0');
function progLabel(it){return `S${pad(it.curSeason||1)}E${pad(it.curEp||0)}`;}
function pcardHtml(it,ix){
  const draggable=(tab==='queue'&&queueSort==='manual');
  const nextBadge=(draggable&&ix===0)?`<span class="next-badge">⭐ التالي</span>`:'';
  return `
    <article class="pcard${draggable?' draggable':''}" ${draggable?'draggable="true"':''} data-act="open" data-id="${it.id}" data-itemid="${it.id}" tabindex="0" role="button" aria-label="${esc(it.title)}">
      ${nextBadge}
      ${it.poster
        ?`<img src="${esc(it.poster)}" alt="" loading="lazy">`
        :`<div class="noimg"><span class="fi">🎞</span><span class="nt" dir="auto">${esc(it.title)}</span></div>`}
      ${it.imdb?`<span class="chip imdb">★ ${it.imdb}</span>`:''}
      ${stampHtml(it)}
      ${it.newSeason?`<button class="bell" data-act="ackSeason" data-id="${it.id}" title="اضغط لما تشوفه">🔔 موسم جديد</button>`:''}
      ${quickHtml(it)}
      <div class="grad">
        <div class="ptitle" dir="auto">${esc(it.title)}</div>
        <div class="pyear">${it.status==='watching'?progLabel(it)+' • ':''}${it.type==='tv'?'مسلسل':'فيلم'}${it.year?' • '+it.year:''}</div>
      </div>
    </article>`;
}
function quickHtml(it){
  if(it.status==='queue'){
    return `<div class="quick">
      <button class="btn btn-amber" data-act="player" data-id="${it.id}">▶ شغّل</button>
      <button class="btn" data-act="watched" data-id="${it.id}">✔ شفته</button>
    </div>`;
  }
  if(it.status==='watching'){
    return `<div class="quick">
      <button class="btn btn-amber" data-act="player" data-id="${it.id}">▶ كمّل</button>
      <button class="btn" data-act="epPlus" data-id="${it.id}">＋ حلقة</button>
    </div>`;
  }
  return '';
}

function render(){
  document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('on',b.dataset.tab===tab));
  $('cQueue').textContent=items.filter(i=>i.status==='queue').length||'';
  $('cWatching').textContent=items.filter(i=>i.status==='watching').length||'';
  $('cWatched').textContent=items.filter(i=>i.status==='watched').length||'';
  $('cDropped').textContent=items.filter(i=>i.status==='dropped').length||'';
  $('randBtn').style.display=tab==='queue'?'':'none';
  const hasFilms=items.some(i=>i.status==='queue'&&i.type==='film');
  $('mysteryBox').style.display=(tab==='queue'&&hasFilms)?'flex':'none';
  $('sortBtn').style.display=(tab==='dropped'||tab==='watching')?'none':'';
  $('sortBtn').textContent=tab==='watched'
    ?(sortDesc?'⇅ ★ الأعلى':'⇅ ★ الأقل')
    :(queueSort==='manual'?'✋ ترتيبي':queueSort==='added'?'⇅ الأحدث':queueSort==='imdbDesc'?'⇅ IMDb ↑':'⇅ IMDb ↓');
  $('sortBtn').title='اضغط لتغيير الترتيب';
  $('viewBtn').textContent=view==='grid'?'☰':'▦';
  $('viewBtn').title=view==='grid'?'اعرض كقايمة':'اعرض كحائط بوسترات';

  renderStats();
  const q=$('search').value.trim().toLowerCase();
  const tabRows=items.filter(i=>i.status===tab);
  renderChips(tabRows);
  let rows=tabRows;
  if(filterType!=='all')rows=rows.filter(i=>i.type===filterType);
  if(filterGenre)rows=rows.filter(i=>(i.genre||'').toLowerCase().includes(filterGenre.toLowerCase()));
  if(q)rows=rows.filter(i=>i.title.toLowerCase().includes(q)||(i.genre||'').toLowerCase().includes(q));
  if(tab==='watched')rows.sort((a,b)=>sortDesc?(b.rating||0)-(a.rating||0):(a.rating||0)-(b.rating||0));
  if(tab==='queue'&&queueSort==='manual')
    rows.sort((a,b)=>(a.order??a.added??0)-(b.order??b.added??0));
  if(tab==='queue'&&(queueSort==='imdbDesc'||queueSort==='imdbAsc'))
    rows.sort((a,b)=>queueSort==='imdbDesc'?(b.imdb||0)-(a.imdb||0):(a.imdb||99)-(b.imdb||99));

  const list=$('list');
  if(!rows.length){
    list.className='';
    list.innerHTML=`<div class="empty"><b>${tab==='queue'?'الحائط فاضي':tab==='watching'?'مش بتتفرج على حاجة دلوقتي':tab==='dropped'?'مفيش حاجة مسبوتة':'لسه مقيمتش حاجة'}</b>${
      (q||filterType!=='all'||filterGenre)?'مفيش نتايج بالفلاتر دي':(tab==='queue'?'ضيف أول فيلم أو مسلسل من "＋ إضافة جديد" أو من أي صفحة على IMDb':tab==='watching'?'افتح أي مسلسل في "هشوفهم" ودوس "▶ بدأته"':tab==='dropped'?'لو بدأت حاجة وزهقت منها، افتحها ودوس "✖ سبته"':'لما تخلص حاجة من القايمة، افتحها وقيمها')}</div>`;
    return;
  }

  if(view==='grid'){
    list.className='wall';
    list.innerHTML=rows.map((it,ix)=>pcardHtml(it,ix)).join('');
    if(tab==='queue'&&queueSort==='manual')enableDrag();
  }else{
    list.className='rows';
    list.innerHTML=rows.map(it=>`
      <article class="row" data-act="open" data-id="${it.id}" data-itemid="${it.id}" tabindex="0" role="button" aria-label="${esc(it.title)}">
        <div class="thumb"><span class="fi">🎞</span>${it.poster?`<img src="${esc(it.poster)}" alt="" loading="lazy">`:''}</div>
        <div class="rbody">
          <div class="rtitle" dir="auto">${esc(it.title)}</div>
          <div class="rmeta">${it.status==='watching'?`<span class="iv">${progLabel(it)}</span><span class="dot">•</span>`:''}${it.type==='tv'?'مسلسل':'فيلم'}${it.year?`<span class="dot">•</span>${it.year}`:''}${it.genre?`<span class="dot">•</span><span dir="auto">${esc(it.genre)}</span>`:''}${it.imdb?`<span class="dot">•</span><span class="iv">IMDb ★ ${it.imdb}</span>`:''}${it.status==='watched'&&it.rating?`<span class="dot">•</span><span class="iv">تقييمي ${it.rating}/10</span>`:''}</div>
          ${it.newSeason?`<div><button class="bell" data-act="ackSeason" data-id="${it.id}">🔔 موسم جديد</button></div>`:''}
          ${it.desc?`<div class="rdesc" dir="auto">${esc(it.desc)}</div>`:''}
          <div class="ract">
            ${it.status==='queue'
              ?`<button class="btn btn-sm btn-amber" data-act="watched" data-id="${it.id}">✔ شفته</button>`+
                (it.type==='tv'?`<button class="btn btn-sm" data-act="startWatch" data-id="${it.id}">▶ بدأته</button>`:'')+
                sites.map((s,ix)=>`<button class="btn btn-sm btn-watch" data-act="watch" data-id="${it.id}" data-site="${ix}">▶ ${esc(s.name)}</button>`).join('')
              :it.status==='watching'
              ?`<button class="btn btn-sm btn-amber" data-act="epPlus" data-id="${it.id}">＋ حلقة</button>
                 <button class="btn btn-sm" data-act="watched" data-id="${it.id}">✔ خلصته</button>`
              :''}
          </div>
        </div>
      </article>`).join('');
  }
}

/* ================= السحب لإعادة الترتيب ================= */
let dragId=null;
function enableDrag(){
  const list=$('list');
  list.querySelectorAll('.pcard.draggable').forEach(card=>{
    card.addEventListener('dragstart',e=>{
      dragId=card.dataset.id;card.classList.add('dragging');
      e.dataTransfer.effectAllowed='move';
    });
    card.addEventListener('dragend',()=>{card.classList.remove('dragging');});
    card.addEventListener('dragover',e=>{
      e.preventDefault();
      const dragging=list.querySelector('.dragging');
      if(!dragging||dragging===card)return;
      const r=card.getBoundingClientRect();
      const before=(e.clientY<r.top+r.height/2);
      card.parentNode.insertBefore(dragging,before?card:card.nextSibling);
    });
    card.addEventListener('drop',async e=>{
      e.preventDefault();
      await commitOrder();
    });
  });
}
async function commitOrder(){
  const ids=[...$('list').querySelectorAll('.pcard')].map(c=>c.dataset.id);
  const base=Date.now();
  ids.forEach((id,ix)=>{const it=items.find(i=>i.id===id);if(it)it.order=base+ix;});
  await persist();
  render();
}

/* ================= المودال ================= */
function openModal(id){
  modalId=id;playerOpen=false;mysteryMode=false;mysteryId=null;
  renderModal();
  $('overlay').classList.add('show');
  loadBackdrop(items.find(i=>i.id===id));
}
function closeModal(){
  modalId=null;playerOpen=false;mysteryMode=false;mysteryId=null;
  if(mysteryCountTimer){clearTimeout(mysteryCountTimer);mysteryCountTimer=null;}
  $('overlay').classList.remove('theater');
  $('modal').classList.remove('wide');
  $('overlay').classList.remove('show');
}
$('overlay').addEventListener('click',e=>{if(e.target===$('overlay'))closeModal();});
document.addEventListener('keydown',e=>{
  if(e.key!=='Escape')return;
  if($('importOverlay').classList.contains('show'))importClose();
  else if($('settingsOverlay').classList.contains('show'))closeSettings();
  else if($('partyOverlay').classList.contains('show'))partyClose();
  else if($('statsOverlay').classList.contains('show'))closeStats();
  else if(playerOpen){playerOpen=false;renderModal();}
  else if(modalId)closeModal();
});

async function loadBackdrop(it){
  if(!it||it.backdrop!=null||it._bdTried)return;
  it._bdTried=true;
  try{
    const tid=await resolveTmdb(it);
    const d=await tmdbFetch(`/${it.type==='tv'?'tv':'movie'}/${tid}`);
    it.backdrop=d.backdrop_path||'';
    await persist();
    if(modalId===it.id)renderModal();
  }catch(e){}
}

function renderModal(){
  const it=items.find(i=>i.id===modalId);
  if(!it){closeModal();return;}
  $('modal').classList.toggle('wide',playerOpen);
  $('overlay').classList.toggle('theater',playerOpen);
  if(playerOpen){$('modal').innerHTML=renderPlayer(it);partySyncMedia(it);return;}
  const bd=it.backdrop?`https://image.tmdb.org/t/p/w780${it.backdrop}`:null;
  const sitesBtns=(it.status==='queue'||it.status==='watching')
    ?sites.map((s,ix)=>`<button class="btn btn-sm btn-watch" data-act="watch" data-id="${it.id}" data-site="${ix}">▶ ${esc(s.name)}</button>`).join('')
    :'';
  const total=it.seasonEps?it.seasonEps[it.curSeason||1]:null;
  const remain=total!=null?Math.max(0,total-(it.curEp||0)):null;
  const progSec=it.status==='watching'?`
    <div class="msec">
      <div class="sh">متابعة الحلقات</div>
      <div class="prog">
        <span class="plab">الموسم</span>
        <button class="stepbtn" data-act="sMinus" data-id="${it.id}">−</button>
        <span class="pnum">${it.curSeason||1}</span>
        <button class="stepbtn" data-act="sPlus" data-id="${it.id}">+</button>
        <span class="plab" style="margin-inline-start:10px">الحلقة</span>
        <button class="stepbtn" data-act="eMinus" data-id="${it.id}">−</button>
        <span class="pnum">${it.curEp||0}</span>
        <button class="btn btn-sm btn-amber" data-act="epPlus" data-id="${it.id}">＋ حلقة اتفرجت</button>
      </div>
      <div class="remain">${
        remain==null?'واقف عند '+progLabel(it)+(it.tmdbId?'':' — عدد حلقات المواسم بيتجاب من TMDB لو المفتاح متسجل')
        :remain>0?`فاضلك ${remain} من ${total} حلقات في موسم ${it.curSeason||1}${it.totalSeasons?' — إجمالي '+it.totalSeasons+' مواسم':''}`
        :'خلصت الموسم ده ✔'}</div>
    </div>`:'';
  const rateSec=it.status==='watched'?`
    <div class="msec">
      <div class="sh">تقييمي من 10</div>
      <div class="pills">${[1,2,3,4,5,6,7,8,9,10].map(n=>
        `<button class="pill ${it.rating===n?'on':''}" data-act="rate" data-id="${it.id}" data-n="${n}">${n}</button>`).join('')}</div>
      <div class="noterow">
        <input type="text" id="mNote" dir="auto" value="${esc(it.note)}" placeholder="ليه عجبك / معجبكش؟ — سطر واحد بيحسّن ترشيحات الـ AI">
        <button class="btn btn-sm btn-amber" data-act="saveNote" data-id="${it.id}">حفظ</button>
      </div>
    </div>`
    :it.status==='dropped'?`
    <div class="msec">
      <div class="sh">ليه سبته؟</div>
      <div class="noterow">
        <input type="text" id="mNote" dir="auto" value="${esc(it.note)}" placeholder="بيدخل ملف الذوق كإشارة سلبية قوية للـ AI">
        <button class="btn btn-sm btn-amber" data-act="saveNote" data-id="${it.id}">حفظ</button>
      </div>
    </div>`
    :(it.note?`<div class="msec"><div class="sh">ملاحظتي</div><div class="mnote-view" dir="auto">${esc(it.note)}</div></div>`:'');

  $('modal').innerHTML=`
    <div class="bdrop">${bd?`<img src="${esc(bd)}" alt="">`:''}</div>
    <button class="mclose" data-act="closeModal" title="إغلاق">✕</button>
    <div class="mhead">
      <div class="mposter">${it.poster?`<img src="${esc(it.poster)}" alt="">`:`<div class="fi">🎞</div>`}</div>
      <div class="mtitles">
        <div class="mtitle" dir="auto">${esc(it.title)}</div>
        <div class="mchips">
          <span class="mchip">${it.type==='tv'?'مسلسل':'فيلم'}</span>
          ${it.year?`<span class="mchip">${it.year}</span>`:''}
          ${it.imdb?`<span class="mchip iv">IMDb ★ ${it.imdb}</span>`:''}
          ${it.genre?`<span class="mchip" dir="auto">${esc(it.genre)}</span>`:''}
        </div>
      </div>
    </div>
    <div class="mbody">
      ${it.newSeason?`<div style="margin-bottom:12px"><button class="bell" style="position:static;box-shadow:none" data-act="ackSeason" data-id="${it.id}">🔔 موسم جديد نزل — اضغط لما تشوفه</button></div>`:''}
      ${it.desc?`<div class="mdesc" dir="auto">${esc(it.desc)}</div>`:''}
      ${it.recWhy||it.recFrom?`<div class="msec"><div class="sh">🤖 اترشحلك ليه</div><div class="rw">${recWhyHtml(it.recWhy,it.recFrom)}</div></div>`:''}
      ${progSec}
      ${rateSec}
      <div class="msec">
        <div class="mact">
          <button class="btn btn-amber" data-act="player" data-id="${it.id}">▶ شغّل هنا</button>
          ${it.status==='queue'?`<button class="btn" data-act="watched" data-id="${it.id}">✔ شفته — قيمه</button>`:''}
          ${it.status==='queue'&&it.type==='tv'?`<button class="btn" data-act="startWatch" data-id="${it.id}">▶ بدأته</button>`:''}
          ${it.status==='watching'?`<button class="btn" data-act="watched" data-id="${it.id}">✔ خلصته — قيمه</button>`:''}
          <button class="btn btn-ghost" data-act="moreToggle">⋯ المزيد</button>
        </div>
        <div class="mact more" id="moreActs" style="display:none;margin-top:9px">
          <button class="btn btn-sm" data-act="download" data-id="${it.id}">⬇ تحميل</button>
          ${sitesBtns}
          <button class="btn btn-sm btn-ghost" data-act="trailer" data-id="${it.id}">🎬 تريلر</button>
          ${(it.status==='queue'||it.status==='watching')?`<button class="btn btn-sm btn-ghost" data-act="drop" data-id="${it.id}">✖ سبته</button>`:''}
          ${it.status!=='queue'?`<button class="btn btn-sm btn-ghost" data-act="toQueue" data-id="${it.id}">↩ رجعه للقايمة</button>`:''}
          <button class="btn btn-sm btn-ghost" data-act="edit" data-id="${it.id}">تعديل</button>
          <button class="btn btn-sm btn-ghost btn-danger" data-act="del" data-id="${it.id}">حذف</button>
        </div>
      </div>
    </div>`;
}

/* ================= أفعال العناوين ================= */
async function startWatch(id){
  const it=items.find(i=>i.id===id);if(!it||it.type!=='tv')return;
  it.status='watching';
  if(it.curSeason==null){it.curSeason=1;it.curEp=0;}
  await persist();render();openModal(id);
  loadSeasonEps(it);
}
async function loadSeasonEps(it){
  if(it.seasonEps)return;
  try{
    const tid=await resolveTmdb(it);
    const d=await tmdbFetch(`/tv/${tid}`);
    const eps={};(d.seasons||[]).filter(s=>s.season_number>0).forEach(s=>eps[s.season_number]=s.episode_count);
    it.seasonEps=eps;it.totalSeasons=d.number_of_seasons||Object.keys(eps).length;
    if(d.backdrop_path&&!it.backdrop)it.backdrop=d.backdrop_path;
    await persist();
    if(modalId===it.id)renderModal();
  }catch(e){}
}
async function epPlus(id){
  const it=items.find(i=>i.id===id);if(!it)return;
  it.curEp=(it.curEp||0)+1;
  const total=it.seasonEps?it.seasonEps[it.curSeason||1]:null;
  if(total&&it.curEp>=total){
    if(it.totalSeasons&&(it.curSeason||1)<it.totalSeasons){
      toast(`خلصت موسم ${it.curSeason} ✔ يلا على موسم ${it.curSeason+1}`);
      it.curSeason++;it.curEp=0;
    }else{
      it.curEp=total;
      toast('خلصت المسلسل كله 🎉 دوس "✔ خلصته" وقيمه');
    }
  }
  await persist();render();if(modalId)renderModal();
}
async function stepProg(id,field,delta){
  const it=items.find(i=>i.id===id);if(!it)return;
  if(field==='s'){
    it.curSeason=Math.max(1,(it.curSeason||1)+delta);
    if(it.totalSeasons)it.curSeason=Math.min(it.curSeason,it.totalSeasons);
    it.curEp=0;
  }else{
    it.curEp=Math.max(0,(it.curEp||0)+delta);
    const total=it.seasonEps?it.seasonEps[it.curSeason||1]:null;
    if(total)it.curEp=Math.min(it.curEp,total);
  }
  await persist();render();if(modalId)renderModal();
}
async function markWatched(id){
  const it=items.find(i=>i.id===id);if(!it)return;
  it.status='watched';
  if(!it.watchedAt)it.watchedAt=Date.now();
  await persist();render();openModal(id);
}
async function markDropped(id){
  const it=items.find(i=>i.id===id);if(!it)return;
  it.status='dropped';it.rating=null;
  await persist();render();openModal(id);
}
async function setRating(id,n){
  const it=items.find(i=>i.id===id);if(!it)return;
  const note=$('mNote');if(note)it.note=note.value.trim();
  it.rating=n;
  await persist();render();if(modalId)renderModal();
}
async function saveNote(id){
  const it=items.find(i=>i.id===id);if(!it)return;
  const note=$('mNote');if(note)it.note=note.value.trim();
  await persist();render();toast('اتحفظ ✔');
}
async function backToQueue(id){
  const it=items.find(i=>i.id===id);if(!it)return;
  it.status='queue';it.rating=null;it.note='';
  await persist();render();if(modalId)renderModal();
}
async function del(id){
  if(!confirm('متأكد من الحذف؟'))return;
  items=items.filter(i=>i.id!==id);
  if(modalId===id)closeModal();
  await persist();render();toast('اتحذف');
}

/* ================= TMDB ================= */
async function saveTmdb(){
  const k=$('tmdbKey').value.trim();
  await sset('watchlist:tmdbkey',k);
  toast(k?'مفتاح TMDB اتحفظ ✔':'المفتاح اتشال');
}
async function tmdbFetch(path){
  const tok=(await sget('watchlist:tmdbkey'))||'';
  if(!tok)throw new Error('NO_KEY');
  const isV4=tok.startsWith('eyJ');
  const url='https://api.themoviedb.org/3'+path+(isV4?'':(path.includes('?')?'&':'?')+'api_key='+encodeURIComponent(tok));
  const res=await fetch(url,isV4?{headers:{Authorization:'Bearer '+tok}}:undefined);
  if(res.status===401)throw new Error('BAD_KEY');
  if(!res.ok)throw new Error('TMDB_'+res.status);
  return res.json();
}
async function resolveTmdb(it){
  if(it.tmdbId)return it.tmdbId;
  let id=null;
  // أدق طريقة: التحويل المباشر من رقم IMDb
  if(it.imdbID){
    try{
      const d=await tmdbFetch(`/find/${it.imdbID}?external_source=imdb_id`);
      const r=(it.type==='tv'?d.tv_results:d.movie_results)[0]||(d.movie_results||[])[0]||(d.tv_results||[])[0];
      if(r)id=r.id;
    }catch(e){if(e.message==='NO_KEY'||e.message==='BAD_KEY')throw e;}
  }
  // خطة بديلة: البحث بالاسم والسنة
  if(!id){
    const kind=it.type==='tv'?'tv':'movie';
    const yr=it.year?`&${kind==='tv'?'first_air_date_year':'year'}=${it.year}`:'';
    const d=await tmdbFetch(`/search/${kind}?query=${encodeURIComponent(it.title)}${yr}`);
    if(d.results&&d.results.length)id=d.results[0].id;
  }
  if(!id)throw new Error('NOT_FOUND');
  it.tmdbId=id;await persist();
  return id;
}

/* ================= مواقع المشاهدة ================= */
function renderSites(){
  const box=$('sitesList');
  box.innerHTML=sites.length?sites.map((s,ix)=>
    `<div class="site-row">
      <span class="site-name" dir="auto">▶ ${esc(s.name)}</span>
      <span class="site-url" dir="ltr">${esc(s.url)}</span>
      <button class="btn btn-sm btn-ghost btn-danger" data-act="delSite" data-ix="${ix}">✕</button>
    </div>`).join('')
    :'<div style="font-size:.8rem;color:var(--muted)">مفيش مواقع متسجلة — ضيف واحد تحت</div>';
}
async function addSite(){
  const name=$('siteName').value.trim();
  let url=$('siteUrl').value.trim();
  if(!name||!url){toast('اكتب اسم الموقع ولينك البحث');return;}
  if(!/^https?:\/\//i.test(url))url='https://'+url;
  if(!url.includes('{q}')&&!url.includes('{tmdbID}')){
    // لو مفيش placeholder نفترض بحث ووردبريس القياسي
    url=url.replace(/\/+$/,'')+'/?s={q}';
  }
  sites.push({name,url});
  await sset('watchlist:sites',JSON.stringify(sites));
  $('siteName').value='';$('siteUrl').value='';
  renderSites();render();toast('الموقع اتضاف ✔');
}
async function delSite(ix){
  sites.splice(ix,1);
  await sset('watchlist:sites',JSON.stringify(sites));
  renderSites();render();if(modalId)renderModal();
}
function fillUrlRaw(tpl,it,tid){
  let url=tpl;
  if(it.type!=='tv'){
    // الأفلام: شيل أجزاء الموسم/الحلقة من المسار أو الكويري
    url=url.replace(/\/\{season\}\/\{episode\}/g,'')
           .replace(/[?&][A-Za-z_]*=\{season\}/g,'')
           .replace(/[?&][A-Za-z_]*=\{episode\}/g,'')
           .replace(/\?&/,'?').replace(/[?&]$/,'');
  }
  return url
    .replace(/\{imdbID\}/g,it.imdbID||'')
    .replace(/\{tmdbID\}/g,tid??'')
    .replace(/\{type\}/g,it.type==='tv'?'tv':'movie')
    .replace(/\{season\}/g,String(it.curSeason||1))
    .replace(/\{episode\}/g,String((it.curEp||0)+1))
    .replace(/\{q\}/g,encodeURIComponent(it.title));
}
// أي قالب لينك (مواقع/بلاير/تحميل) لازم يطلع http(s) — يمنع javascript: من ملف إعدادات متلغّم
function fillUrl(tpl,it,tid){
  const u=fillUrlRaw(tpl,it,tid);
  if(!isHttp(u))throw new Error('BAD_URL');
  return u;
}
async function openWatch(id,ix){
  const it=items.find(i=>i.id===id);const s=sites[ix];
  if(!it||!s)return;
  if(s.url.includes('{tmdbID}')){
    // بنفتح التاب فوراً قبل الـ fetch عشان مانع النوافذ المنبثقة ميقفلوش
    const win=window.open('about:blank','_blank');
    try{
      const tid=await resolveTmdb(it);
      win.location=fillUrl(s.url,it,tid);
    }catch(e){
      if(win)win.close();
      toast(e.message==='BAD_URL'?'اللينك ده مش صالح — راجعه في الإعدادات':e.message==='NO_KEY'?'حط مفتاح TMDB في الإعدادات الأول'
        :e.message==='BAD_KEY'?'مفتاح TMDB غلط — راجعه'
        :'معرفتش ألاقي رقم TMDB للعنوان ده');
    }
  }else{
    try{window.open(fillUrl(s.url,it,''),'_blank');}
    catch(e){toast('لينك الموقع ده مش صالح — راجعه في الإعدادات');}
  }
}
async function saveDl(){
  const t=$('dlTpl').value.trim();
  await sset('watchlist:dlTpl',t||'');
  if(!t)$('dlTpl').value=DEFAULT_DL;
  toast('لينك التحميل اتحفظ ✔');
}
async function openDownload(id){
  const it=items.find(i=>i.id===id);if(!it)return;
  const tpl=($('dlTpl')&&$('dlTpl').value.trim())||(await sget('watchlist:dlTpl'))||DEFAULT_DL;
  const needsTmdb=tpl.includes('{tmdbID}');
  const win=window.open('about:blank','_blank');
  try{
    let tid=it.tmdbId;
    if(needsTmdb&&!tid)tid=await resolveTmdb(it);
    win.location=fillUrl(tpl,it,tid);
  }catch(e){
    if(win)win.close();
    toast(e.message==='BAD_URL'?'اللينك ده مش صالح — راجعه في الإعدادات':e.message==='NO_KEY'?'حط مفتاح TMDB في الإعدادات الأول'
      :e.message==='BAD_KEY'?'مفتاح TMDB غلط — راجعه'
      :'معرفتش ألاقي رقم TMDB للتحميل');
  }
}
function openTrailer(id){
  const it=items.find(i=>i.id===id);if(!it)return;
  window.open('https://www.youtube.com/results?search_query='+
    encodeURIComponent(it.title+' '+(it.year||'')+' trailer'),'_blank');
}

/* ================= البلاير الداخلي ================= */
async function savePlayer(){
  const t=$('playerTpl').value.trim();
  await sset('watchlist:playerTpl',t||'');
  if(!t)$('playerTpl').value=DEFAULT_PLAYER;
  toast('قالب البلاير اتحفظ ✔');
}
async function openPlayer(id){
  const it=items.find(i=>i.id===id);if(!it)return;
  playerOpen=true;
  if(modalId!==id){modalId=id;$('overlay').classList.add('show');}
  renderModal();
  if(!it.tmdbId){
    try{await resolveTmdb(it);}
    catch(e){
      playerOpen=false;renderModal();
      toast(e.message==='BAD_URL'?'اللينك ده مش صالح — راجعه في الإعدادات':e.message==='NO_KEY'?'حط مفتاح TMDB في الإعدادات الأول'
        :e.message==='BAD_KEY'?'مفتاح TMDB غلط — راجعه'
        :'معرفتش ألاقي رقم TMDB للعنوان ده');
      return;
    }
  }
  // لو أي قالب محتاج رقم IMDb وهو ناقص — نجيبه مرة واحدة ونخزنه
  if(!it.imdbID){
    try{
      const ex=await tmdbFetch(`/${it.type==='tv'?'tv':'movie'}/${it.tmdbId}/external_ids`);
      if(ex.imdb_id){it.imdbID=ex.imdb_id;await persist();}
    }catch(e){}
  }
  renderModal();
}
function shieldLabel(){
  if($('shieldBtn'))$('shieldBtn').textContent='🛡 مانع الإعلانات الصارم: '+(playerShield?'شغال':'مقفول');
}
async function togglePlayerShield(){
  playerShield=!playerShield;
  await sset('watchlist:playerShield',playerShield?'1':'0');
  shieldLabel();
  if(modalId&&playerOpen)renderModal();
  toast(playerShield?'🛡 الوضع الصارم اشتغل — لو سيرفر رفض يشغّل، اقفله':'رجعنا للوضع العادي');
}
function playerFs(){
  const box=document.querySelector('.playerbox');
  if(!box)return;
  const el=document.fullscreenElement||document.webkitFullscreenElement;
  if(el){(document.exitFullscreen||document.webkitExitFullscreen).call(document);return;}
  const req=box.requestFullscreen||box.webkitRequestFullscreen;
  if(req)req.call(box);
  else toast('المتصفح رافض ملء الشاشة — جرّب زرار النافذة 🗗');
}
function playerPop(id){
  const it=items.find(i=>i.id===id);if(!it||!it.tmdbId)return;
  const src=playerSrc(it);
  window.open(src,'_blank','popup=yes,width=1280,height=760,noopener');
}
async function playerSrvCycle(n){
  await setPlayerSrv((playerSrv+1)%n);
}
async function setPlayerSrv(ix){
  playerSrv=ix;
  await sset('watchlist:playerSrv',String(ix));
  renderModal();
  try{
    const host=new URL(currentPlayerTpl().replace(/\{[^}]+\}/g,'x')).hostname;
    toast('بحمّل من '+host);
  }catch(e){}
}
function currentPlayerTpl(){
  if(playerSrv<PLAYER_SERVERS.length)return PLAYER_SERVERS[playerSrv].tpl;
  return $('playerTpl').value.trim()||DEFAULT_PLAYER;
}
async function mysteryPlay(){
  const pool=items.filter(i=>i.status==='queue'&&i.type==='film');
  if(!pool.length){toast('محتاج أفلام في "هشوفهم" الأول 🎬');return;}
  const weights=pool.map(i=>Math.pow(i.imdb||6,2));
  const tot=weights.reduce((a,b)=>a+b,0);
  let r=Math.random()*tot,pick=pool[0];
  for(let j=0;j<pool.length;j++){r-=weights[j];if(r<=0){pick=pool[j];break;}}
  mysteryMode=true;mysteryId=pick.id;
  if(!pick.tmdbId){
    try{await resolveTmdb(pick);}
    catch(e){mysteryMode=false;mysteryId=null;toast('معرفتش أجهّز الفيلم — جرّب تاني');return;}
  }
  modalId=pick.id;playerOpen=true;
  $('overlay').classList.add('show');
  renderModal();
}
let mysteryCountTimer=null;
function mysteryStart(){
  // بنشيل الغطا الكامل ونحط بدله بلور خفيف على البلاير + تعليمات
  // فأنت بتضغط Play في نص البلاير وانت مش شايف تفاصيل الفيلم
  const box=document.querySelector('.playerbox');
  const v=$('wlVeil');
  if(v)v.remove();
  if(box)box.classList.add('wl-blurred');
  const hint=document.createElement('div');
  hint.className='wl-hint';hint.id='wlHint';
  hint.innerHTML='<div class="wl-hint-in"><div class="wl-hint-t">دوس ▶ في نص الشاشة عشان تبدأ</div><button class="btn btn-amber" data-act="mysteryClear">✔ الفيلم بدأ — وضّح الصورة</button></div>';
  if(box)box.appendChild(hint);
}
function mysteryClear(){
  const box=document.querySelector('.playerbox');
  if(box)box.classList.remove('wl-blurred');
  const h=$('wlHint');if(h)h.remove();
}
function mysteryReveal(id){
  mysteryMode=false;
  renderModal();
  const it=items.find(i=>i.id===id);
  if(it)toast('🎬 '+it.title);
}
async function playerNext(id){
  await epPlus(id); // بيعمل persist + renderModal فالبلاير بيتحمّل بالحلقة الجديدة
}
function playerSrc(it){
  if(!it.tmdbId)return null;
  let s;
  try{s=fillUrl(currentPlayerTpl(),it,it.tmdbId);}catch(e){return null;}
  if(subLang&&subLang!=='off'){
    // الترجمة الافتراضية — vidsrc وأشباهه بيفهموا ds_lang، وبعضهم sub_lang
    const q='ds_lang='+encodeURIComponent(subLang)+'&sub_lang='+encodeURIComponent(subLang);
    s+=(s.includes('?')?'&':'?')+q;
  }
  if(mysteryMode&&mysteryId===it.id){
    s+=(s.includes('#')?'&':'#')+'wlmt='+encodeURIComponent(it.title);
  }
  return s;
}
async function saveSubLang(v){
  subLang=v;
  await sset('watchlist:subLang',v);
  document.querySelectorAll('#subLangs .sl').forEach(b=>b.classList.toggle('on',b.dataset.v===v));
  toast(v==='off'?'الترجمة التلقائية اتقفلت':'الترجمة الافتراضية: '+({ar:'عربي',en:'إنجليزي',fr:'فرنسي',es:'إسباني'}[v]||v));
}
function renderPlayer(it){
  const tplP=currentPlayerTpl();
  const src=playerSrc(it);
  const mystery=mysteryMode&&mysteryId===it.id;
  const epTxt=it.type==='tv'?` — <span class="ep">S${pad(it.curSeason||1)}E${pad((it.curEp||0)+1)}</span>`:'';
  const custom=$('playerTpl').value.trim();
  const nSrv=PLAYER_SERVERS.length+((custom&&custom!==DEFAULT_PLAYER)?1:0);
  const srvName=playerSrv<PLAYER_SERVERS.length?PLAYER_SERVERS[playerSrv].name:'مخصص';
  const srvHost=(()=>{try{return new URL(currentPlayerTpl().replace(/\{[^}]+\}/g,'x')).hostname;}catch(e){return'';}})();
  const srvChips=`<button class="srv on" data-act="playerSrvCycle" data-n="${nSrv}" title="بدّل السيرفر لو مش شغال — دلوقتي: ${esc(srvHost)}">🖧 ${srvName} ▸</button>`;
  const shieldChip='';
  const frame=!src?'':playerShield
    ?`<iframe src="${esc(src)}" sandbox="allow-scripts allow-same-origin allow-forms allow-presentation allow-orientation-lock" allow="fullscreen 'src' *; encrypted-media *; autoplay *; picture-in-picture *" allowfullscreen webkitallowfullscreen mozallowfullscreen referrerpolicy="no-referrer"></iframe>`
    :`<iframe src="${esc(src)}" allow="fullscreen 'src' *; encrypted-media *; autoplay *; picture-in-picture *" allowfullscreen webkitallowfullscreen mozallowfullscreen></iframe>`;
  return `
    <div class="pbar">
      <button class="mclose" style="position:static" data-act="playerClose" title="رجوع للتفاصيل">✕</button>
      <div class="pt" dir="auto">${mystery?'🎁 فيلم غامض':'▶ '+esc(it.title)+epTxt}</div>
      ${mystery?'':srvChips}
      ${mystery?'':shieldChip}
      ${mystery?'':`<span id="partyBadge">${partyBadgeHtml()}</span>`}
      <button class="srv" data-act="playerFs" title="ملء الشاشة">⛶ ملء الشاشة</button>
      ${mystery
        ?`<button class="srv" data-act="mysteryReveal" data-id="${it.id}" title="اكشف الفيلم">👁 اكشف الاسم</button>`
        :`<button class="srv" data-act="playerPop" data-id="${it.id}" title="افتح البلاير في نافذة مستقلة">🗗 نافذة</button>`}
      ${!mystery&&it.type==='tv'&&it.status==='watching'
        ?`<button class="btn btn-sm btn-amber" data-act="playerNext" data-id="${it.id}">✔ خلصتها — شغّل الجاية</button>`
        :!mystery&&it.type==='tv'&&it.status==='queue'
        ?`<button class="btn btn-sm" data-act="startWatch" data-id="${it.id}">▶ فعّل متابعة الحلقات</button>`:''}
    </div>
    <div class="playerbox">
      ${frame||`<div class="mystery-reveal"><div class="mr-gift">🎁</div><div class="mr-t">بجهّزلك المفاجأة...</div><div class="mr-s">استنى ثانية، الفيلم جاي</div></div>`}
      ${mystery?`<div class="wl-veil" id="wlVeil">
        <div class="wl-veil-gift">🎁</div>
        <div class="wl-veil-t" id="wlVeilT">فيلمك الغامض جاهز</div>
        <div class="wl-veil-s">لما تضغط، الفيلم هيبدأ لوحده ونعديك على شاشة البداية — فمتشوفش بوستر ولا اسم، على طول مشهد من الفيلم 🍿</div>
        <button class="btn btn-amber" data-act="mysteryStart">🍿 ابدأ المفاجأة</button>
      </div>`:''}
    </div>`;
}

/* ================= المفاتيح ================= */
async function saveKey(){
  const k=$('apiKey').value.trim();
  if(!k){toast('اكتب المفتاح الأول');return;}
  await sset('watchlist:omdbkey',k);
  toast('المفتاح اتحفظ ✔');
}

/* ================= نسخة احتياطية واسترجاع ================= */
async function backup(){
  const all=await chrome.storage.local.get(null);
  const blob=new Blob([JSON.stringify(all,null,2)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='watchlist-backup-'+new Date().toISOString().slice(0,10)+'.json';
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href),3000);
  await sset('watchlist:lastBackup',String(Date.now()));
  $('bkBanner').style.display='none';
  toast('النسخة اتنزلت ✔ خبيها في مكان أمين');
}
$('restoreFile').addEventListener('change',async e=>{
  const f=e.target.files[0];e.target.value='';
  if(!f)return;
  try{
    const data=JSON.parse(await f.text());
    if(!data['watchlist:data'])throw new Error('bad');
    JSON.parse(data['watchlist:data']); // تأكيد إنها قايمة صالحة
    if(!confirm('الاسترجاع هيستبدل كل البيانات الحالية بالنسخة دي — متأكد؟'))return;
    await chrome.storage.local.set(data);
    toast('اترجعت ✔');
    setTimeout(()=>location.reload(),600);
  }catch(err){toast('الملف ده مش نسخة احتياطية صالحة');}
});

/* ================= استيراد ترشيحات الـ AI ================= */
$('tasteBtn').onclick=()=>{
  impCands=[];
  $('impText').value='';$('impList').innerHTML='';$('impStatus').textContent='';
  $('impAddBtn').style.display='none';
  $('importOverlay').classList.add('show');
};
function importClose(){$('importOverlay').classList.remove('show');}
// اختيار "شفته" بيعلّم العنوان تلقائياً — انت عايزه يتضاف، بس في "شفتها"
$('impList').addEventListener('change',e=>{
  if(!e.target.classList.contains('impSeen'))return;
  const row=e.target.closest('.impRow'), cb=row.querySelector('input');
  row.classList.toggle('seen',!!e.target.value);
  if(e.target.value)cb.checked=true;
  // شفته = فرصة تكتب رأيك؛ بيتحفظ كملاحظة وبيدخل ملف الذوق
  const note=document.querySelector(`.impNoteRow[data-ix="${cb.dataset.ix}"]`);
  note.hidden=!e.target.value;
  if(e.target.value)note.querySelector('input').focus();
});
$('importOverlay').addEventListener('click',e=>{if(e.target===$('importOverlay'))importClose();});

function parseRecs(text){
  const out=[];const seen=new Set();
  text.split(/\r?\n/).forEach(line=>{
    const m=line.match(/^\s*(?:\d+\s*[\).:\-–—]\s*|[-*•]\s+)(.+)$/);
    if(!m)return;
    let s=m[1].replace(/\*\*|__|\*/g,'').trim();
    // [because: A; B] = العناوين من ذوقك اللي الترشيح مبني عليها — بتتشال قبل أي حاجة عشان سنينها متلخبطش سنة العنوان
    let from=[];
    s=s.replace(/\[\s*because\s*:([^\]]*)\]/i,(_,l)=>{from=l.split(/[;؛]/).map(t=>t.trim()).filter(Boolean).slice(0,5).map(t=>t.slice(0,120));return '';}).trim();
    let year=null;const ym=s.match(/\((?:[^)]*?)?(\d{4})(?:[^)]*)?\)/);
    if(ym)year=parseInt(ym[1]);
    const parts=s.split(/\s+[—–:|]\s+| - /);
    s=parts[0];
    const why=parts.slice(1).join(' — ').trim().slice(0,300);
    s=s.replace(/\([^)]*\)/g,'').replace(/["“”«»]/g,'').trim().replace(/[.,؛;]+$/,'');
    if(s.length<2||s.length>80)return;
    if(!/[A-Za-z\u0600-\u06FF]/.test(s))return;
    const k=s.toLowerCase();if(seen.has(k))return;seen.add(k);
    out.push({title:s,year,why,from});
  });
  return out;
}

function importParse(){
  impCands=parseRecs($('impText').value);
  if(!impCands.length){
    $('impStatus').textContent='مقدرتش أستخرج عناوين — اتأكد إن الرد فيه قايمة مرقمة أو bullets';
    $('impList').innerHTML='';$('impAddBtn').style.display='none';
    return;
  }
  const have=new Set(items.map(i=>i.title.toLowerCase()));
  $('impList').innerHTML=impCands.map((c,ix)=>{
    const dup=have.has(c.title.toLowerCase());
    return `<label class="impRow" style="${dup?'opacity:.45':''}">
      <input type="checkbox" data-ix="${ix}" ${dup?'':'checked'} ${dup?'disabled':''}>
      <span class="impP">⏳</span>
      <span dir="auto">${esc(c.title)}${c.why?`<span class="iwhy" dir="auto">${esc(c.why)}</span>`:''}</span>
      ${c.year?`<span class="iy">${c.year}</span>`:''}
      ${c.why||c.from.length?`<button type="button" class="impWhyBtn" data-act="impWhy" data-ix="${ix}" title="اترشح ليه؟">💡</button>`:''}
      ${dup?'<span class="iy">موجود بالفعل</span>':`<select class="impSeen" title="شفته قبل كده؟ قيّمه ويتضاف لـ'شفتها' — كده الترشيحات الجاية بتبقى أدق">
        <option value="">＋ هشوفه</option>
        ${[10,9,8,7,6,5,4,3,2,1].map(n=>`<option value="${n}">👁 شفته ★${n}</option>`).join('')}
        <option value="w">👁 شفته (من غير تقييم)</option>
      </select>`}
    </label><div class="impWhyBox" data-ix="${ix}" hidden></div>
    <div class="impNoteRow" data-ix="${ix}" hidden><input type="text" class="impNote" dir="auto" maxlength="300" placeholder="رأيك فيه في سطر (اختياري) — عجبك ليه / معجبكش ليه؟ ده بيحسّن الترشيحات الجاية"></div>`;
  }).join('');
  $('impStatus').textContent=`لقيت ${impCands.length} عنوان — شيل علامة اللي مش عايزه، واضغط 💡 عشان تعرف اترشح ليه`;
  $('impAddBtn').style.display='';
  return importPosters();
}

// أحسن نتيجة في TMDB للعنوان (الأقرب للسنة لو معروفة) — للبوستر في قايمة الاختيار وللإضافة نفسها
async function tmdbBest(c){
  const d=await tmdbFetch(`/search/multi?query=${encodeURIComponent(c.title)}`);
  let r=(d.results||[]).filter(x=>x.media_type==='movie'||x.media_type==='tv');
  if(!r.length)return null;
  if(c.year)r.sort((a,b)=>{
    const ya=parseInt((a.release_date||a.first_air_date||'').slice(0,4))||9999;
    const yb=parseInt((b.release_date||b.first_air_date||'').slice(0,4))||9999;
    return Math.abs(ya-c.year)-Math.abs(yb-c.year);
  });
  return r[0];
}

// بوسترات قايمة الاختيار: كل العناوين بالتوازي، ولو العمل عندك بالفعل (نفس رقم TMDB) بيتعلّم "موجود بالفعل"
let impGen=0;
async function importPosters(){
  const gen=++impGen, cands=impCands;
  const boxes=[...document.querySelectorAll('#impList .impP')];
  if(!(await sget('watchlist:tmdbkey'))){boxes.forEach(b=>b.textContent='🎞');return;}
  await Promise.all(cands.map(async(c,ix)=>{
    try{c.tm=await tmdbBest(c);}catch(e){c.tm=undefined;} // undefined = الإضافة تجرب تاني
    const box=boxes[ix];
    if(gen!==impGen||!box)return; // اتعمل استخراج جديد في النص
    box.textContent='';
    const p=c.tm&&c.tm.poster_path;
    if(typeof p==='string'&&/^\/[\w.-]+$/.test(p)){
      const img=document.createElement('img');img.alt='';img.src='https://image.tmdb.org/t/p/w92'+p;box.appendChild(img);
    }else box.textContent='🎞';
    const row=box.closest('.impRow'), cb=row.querySelector('input');
    if(c.tm&&!cb.disabled&&items.some(i=>i.tmdbId===c.tm.id&&(i.type==='tv')===(c.tm.media_type==='tv'))){
      cb.checked=false;cb.disabled=true;row.style.opacity='.45';
      row.querySelector('.impSeen')?.remove();
      document.querySelector(`.impNoteRow[data-ix="${ix}"]`).hidden=true;
      row.insertAdjacentHTML('beforeend','<span class="iy">موجود بالفعل</span>');
    }
  }));
}

async function importFetchOne(c){
  const best=c.tm!==undefined?c.tm:await tmdbBest(c);
  if(!best)return null;
  const type=best.media_type==='tv'?'tv':'film';
  const item={id:uid(),title:best.title||best.name||c.title,type,genre:'',status:'queue',rating:null,note:'',added:Date.now(),
    year:parseInt((best.release_date||best.first_air_date||'').slice(0,4))||c.year||null,
    imdb:null,desc:best.overview||'',
    poster:best.poster_path?'https://image.tmdb.org/t/p/w342'+best.poster_path:null,
    backdrop:best.backdrop_path||null,tmdbId:best.id,imdbID:null};
  try{
    const ex=await tmdbFetch(`/${best.media_type}/${best.id}/external_ids`);
    if(ex.imdb_id){
      item.imdbID=ex.imdb_id;
      const key=(await sget('watchlist:omdbkey'))||DEFAULT_OMDB_KEY;
      const om=await(await fetch(`https://www.omdbapi.com/?apikey=${encodeURIComponent(key)}&i=${ex.imdb_id}`)).json();
      if(om.Response==='True'){
        item.imdb=parseFloat(om.imdbRating)||null;
        if(om.Genre&&om.Genre!=='N/A')item.genre=om.Genre;
        if(om.Plot&&om.Plot!=='N/A')item.desc=om.Plot;
      }
    }
  }catch(e){}
  return item;
}

async function importAdd(){
  const tok=(await sget('watchlist:tmdbkey'))||'';
  if(!tok){$('impStatus').textContent='محتاج مفتاح TMDB الأول — سجّله في الإعدادات تحت';return;}
  const boxes=[...document.querySelectorAll('#impList input:checked')];
  const checked=boxes.map(i=>impCands[parseInt(i.dataset.ix)]);
  // "شفته" = يتضاف لـ"شفتها" بتقييمه — بيدخل ملف الذوق في المرة الجاية فالترشيحات تبقى أدق
  const seenSel=boxes.map(i=>i.closest('.impRow').querySelector('.impSeen')?.value||'');
  const notes=boxes.map(i=>(document.querySelector(`.impNoteRow[data-ix="${i.dataset.ix}"] .impNote`)?.value||'').trim().slice(0,300));
  if(!checked.length){$('impStatus').textContent='اختار عنوان واحد على الأقل';return;}
  $('impAddBtn').disabled=true;
  let ok=0,seen=0,fail=[];
  for(let i=0;i<checked.length;i++){
    $('impStatus').textContent=`بجيب البيانات ${i+1}/${checked.length}: ${checked[i].title}...`;
    try{
      const item=await importFetchOne(checked[i]);
      const s=seenSel[i];
      if(item){
        if(checked[i].why)item.recWhy=checked[i].why;
        if(checked[i].from.length)item.recFrom=checked[i].from;
      }
      if(item&&s){item.status='watched';item.watchedAt=Date.now();item.rating=s==='w'?null:parseInt(s);item.note=notes[i];seen++;}
      if(item){items.unshift(item);ok++;}
      else fail.push(checked[i].title);
    }catch(e){
      if(e.message==='BAD_KEY'){$('impStatus').textContent='مفتاح TMDB غلط — راجعه في الإعدادات';$('impAddBtn').disabled=false;return;}
      fail.push(checked[i].title);
    }
  }
  await persist();
  tab=ok>seen?'queue':'watched';render();
  $('impAddBtn').disabled=false;
  importClose();
  toast(`اتضاف ${ok-seen} لـ"هشوفهم"${seen?` و${seen} لـ"شفتها"`:''} ✔${fail.length?' — فشل: '+fail.join('، '):''}`);
}

/* ================= ترشيحات الـ AI (نسخة الديسكتوب بس) =================
   الطلب نفسه والمفتاح في main.js — الواجهة بتبعت ملف الذوق وتاخد نص الرد بس */
// want = موديلات بنختارها افتراضياً لو طلعت في القايمة اللي رجعت من السيرفر (لو مش موجودة اليوزر بيختار)
const AI_PRESETS={
  ollama:{kind:'openai',url:'http://localhost:11434/v1',local:true},
  lmstudio:{kind:'openai',url:'http://localhost:1234/v1',local:true},
  openai:{kind:'openai',url:'https://api.openai.com/v1',want:['gpt-5-mini','gpt-4o-mini']},
  gemini:{kind:'openai',url:'https://generativelanguage.googleapis.com/v1beta/openai',want:['models/gemini-2.5-flash','gemini-2.5-flash']},
  openrouter:{kind:'openai',url:'https://openrouter.ai/api/v1',want:['openai/gpt-5-mini','openai/gpt-4o-mini']},
  groq:{kind:'openai',url:'https://api.groq.com/openai/v1',want:['llama-3.3-70b-versatile']},
  anthropic:{kind:'anthropic',url:'https://api.anthropic.com/v1',want:['claude-opus-5-5']}
};
// موديلات مش شات (صوت/صور/embeddings) — بتتشال من القايمة عشان متتختارش بالغلط
const AI_NOT_CHAT=/embed|whisper|tts|dall-e|moderation|transcri|realtime|audio|image|imagen|veo|aqa|rerank/i;
let aiWant=[], aiModelsReq=0, aiModelList=[];
const AI_ERR={
  NOT_CONFIGURED:'ظبط الـ AI من الإعدادات الأول (⚙ ← 🤖 الذكاء الاصطناعي)',
  BUSY:'فيه طلب شغال بالفعل — استنى يخلص',
  TIMEOUT:'الـ AI اتأخر أكتر من 3 دقايق — جرب موديل أسرع',
  UNREACHABLE:'مقدرتش أوصل للسيرفر — اتأكد من الرابط وإن السيرفر المحلي شغال',
  BAD_KEY:'المفتاح غلط أو ملوش صلاحية',
  EMPTY:'الـ AI رجّع رد فاضي',
  REFUSED:'الـ AI رفض الطلب — جرب تاني',
  BAD_RESPONSE:'رد مش مفهوم من السيرفر — اتأكد من نوع الـ API',
  BAD_PROMPT:'مفيش بيانات كفاية تتبعت',
  BAD_URL:'الرابط لازم يبقى https (أو http لجهازك/شبكتك المحلية بس)',
  BAD_MODEL:'اكتب اسم الموديل',
  BAD_KIND:'نوع الـ API غلط',
  NO_CRYPTO:'تشفير المفتاح مش متاح على الجهاز ده'
};
const aiErrText=r=>r.error==='HTTP'?`السيرفر رجّع خطأ ${r.status}${r.detail?': '+r.detail:''}`:(AI_ERR[r.error]||'حصل خطأ');

const aiForm=()=>({kind:$('aiKind').value,url:$('aiUrl').value,model:$('aiModel').value,key:$('aiKey').value});
function aiFillModels(list,selected){
  aiModelList=list;$('aiModelQ').value='';
  aiRenderModels(selected);
}
// البحث بيفلتر القايمة؛ كل كلمة لازم تكون موجودة ("gpt mini" تلاقي gpt-4o-mini)، وأول نتيجة بتتختار لو اختيارك اتفلتر
function aiRenderModels(selected){
  const terms=$('aiModelQ').value.toLowerCase().split(/\s+/).filter(Boolean);
  const shown=aiModelList.filter(m=>terms.every(t=>m.toLowerCase().includes(t)));
  const sel=$('aiModel');
  sel.innerHTML=`<option value="">${terms.length?`— ${shown.length} نتيجة —`:'— اختار موديل —'}</option>`
    +shown.map(m=>`<option value="${esc(m)}">${esc(m)}</option>`).join('');
  sel.value=shown.includes(selected)?selected:(terms.length&&shown[0])||'';
}
$('aiModelQ').addEventListener('input',()=>aiRenderModels($('aiModel').value));
async function aiLoad(){
  if(!window.__wlAi)return; // الاكستنشن: يفضل النسخ واللصق اليدوي بس
  $('aiSec').style.display='';$('aiRunBtn').style.display='';
  const c=await window.__wlAi.get();
  $('aiKind').value=c.kind;$('aiUrl').value=c.url;$('aiKey').value='';
  aiFillModels(c.model?[c.model]:[],c.model); // القايمة الكاملة بتتجاب لما تفتح القسم
  $('aiKey').placeholder=c.hasKey?'محفوظ ●●●● — سيبه فاضي عشان يفضل زي ما هو':'sk-...';
  $('aiNote').textContent=c.url?`متظبط: ${c.model} — ${c.hasKey?'بمفتاح':'من غير مفتاح'}`:'لسه مش متظبط — اختار من "اختيار سريع"';
}
async function aiFetchModels(){
  if(!window.__wlAi||!$('aiUrl').value.trim())return;
  const n=++aiModelsReq, keep=$('aiModel').value;
  $('aiNote').textContent='⏳ بجيب الموديلات من السيرفر...';
  const r=await window.__wlAi.models(aiForm());
  if(n!==aiModelsReq)return; // اتغيّر الرابط/المفتاح والطلب ده بقى قديم
  if(!r.ok){$('aiNote').textContent='⚠ '+aiErrText(r);return;}
  const chat=r.models.filter(m=>!AI_NOT_CHAT.test(m)), list=chat.length?chat:r.models;
  if(!list.length){$('aiNote').textContent='⚠ السيرفر مرجّعش أي موديل — لو محلي، نزّل موديل الأول';return;}
  const pick=[keep,...aiWant].find(m=>m&&list.includes(m))||(list.length===1?list[0]:'');
  aiFillModels(list,pick);
  $('aiNote').textContent=`✔ لقيت ${list.length} موديل`+(pick?` — اخترتلك ${pick}، غيّره لو حابب`:' — اختار واحد')+' واضغط "اختبر" أو "حفظ"';
}
async function aiTest(){
  if(!$('aiModel').value){toast('اختار موديل الأول');return;}
  $('aiNote').textContent='🧪 ببعت رسالة تجربة للموديل...';
  const r=await window.__wlAi.test(aiForm());
  $('aiNote').textContent=r.ok?`✔ شغال! الموديل رد في ${(r.ms/1000).toFixed(1)} ثانية: "${r.reply}"`:'✖ '+aiErrText(r);
  return r.ok;
}
async function aiSave(){
  if(!$('aiUrl').value.trim())return aiClear();
  const r=await window.__wlAi.set(aiForm());
  if(!r.ok){toast(r.error==='BAD_MODEL'?'اختار موديل الأول':aiErrText(r));return;}
  const model=$('aiModel').value, opts=aiModelList;
  await aiLoad();
  aiFillModels(opts,model); // متضيّعش القايمة اللي اتجابت
  toast('إعدادات الـ AI اتحفظت ✔ — بجرّب الاتصال...');
  aiTest();
}
async function aiClear(){
  if(!confirm('تمسح إعدادات الـ AI والمفتاح؟'))return;
  await window.__wlAi.set({url:''});
  await aiLoad();toast('إعدادات الـ AI اتمسحت');
}
$('aiPreset').addEventListener('change',e=>{
  const p=AI_PRESETS[e.target.value];
  if(!p)return;
  $('aiKind').value=p.kind;$('aiUrl').value=p.url;aiWant=p.want||[];
  aiFillModels([],'');
  e.target.value='';
  if(p.local||$('aiKey').value.trim())aiFetchModels();
  else{$('aiNote').textContent='🔑 حط المفتاح وهجيب الموديلات لوحدي';$('aiKey').focus();}
});
// أي تغيير في الرابط/النوع/المفتاح = هات القايمة تاني. وأول ما تفتح القسم بنجيبها لو فيه إعدادات محفوظة
['aiUrl','aiKind','aiKey'].forEach(id=>$(id).addEventListener('change',aiFetchModels));
$('aiSec').addEventListener('toggle',e=>{if(e.target.open&&aiModelList.length<=1)aiFetchModels();});
async function aiRun(){
  const btn=$('aiRunBtn');
  btn.disabled=true;
  $('impStatus').textContent='✨ الـ AI بيفكر في ذوقك... (الموديلات المحلية ممكن تاخد دقيقة)';
  try{
    const r=await window.__wlAi.run(tasteProfile());
    if(!r.ok){$('impStatus').textContent='⚠ '+aiErrText(r);return;}
    $('impText').value=r.text;
    importParse(); // نفس مسار اللصق اليدوي: استخراج العناوين وانت تختار
  }catch(e){$('impStatus').textContent='⚠ حصل خطأ غير متوقع';}
  finally{btn.disabled=false;}
}

/* ================= تصدير/استيراد الإعدادات ================= */
const SETTINGS_KEYS=['watchlist:omdbkey','watchlist:tmdbkey','watchlist:sites','watchlist:playerTpl','watchlist:playerSrv','watchlist:playerShield','watchlist:view','watchlist:statsOpen','watchlist:theme','watchlist:dlTpl','watchlist:subLang'];
async function settingsExport(){
  const all=await chrome.storage.local.get(SETTINGS_KEYS);
  const out={__watchlistSettings:1};
  SETTINGS_KEYS.forEach(k=>{if(all[k]!=null)out[k]=all[k];});
  // اكتب القيم الفعلية حتى لو جاية من الـ defaults المدمجة في الكود
  if(out['watchlist:omdbkey']==null)out['watchlist:omdbkey']=DEFAULT_OMDB_KEY;
  if(out['watchlist:playerTpl']==null)out['watchlist:playerTpl']=DEFAULT_PLAYER;
  if(out['watchlist:dlTpl']==null)out['watchlist:dlTpl']=DEFAULT_DL;
  const blob=new Blob([JSON.stringify(out,null,2)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='watchlist-settings-'+new Date().toISOString().slice(0,10)+'.json';
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href),3000);
  toast('الإعدادات اتصدّرت ✔');
}
$('setFile').addEventListener('change',async e=>{
  const f=e.target.files[0];e.target.value='';
  if(!f)return;
  try{
    const data=JSON.parse(await f.text());
    const keys=SETTINGS_KEYS.filter(k=>data[k]!=null);
    if(!data.__watchlistSettings||!keys.length)throw new Error('bad');
    const patch={};keys.forEach(k=>patch[k]=data[k]);
    await chrome.storage.local.set(patch);
    toast('الإعدادات اتستوردت ✔ ('+keys.length+' عنصر)');
    setTimeout(()=>location.reload(),700);
  }catch(err){toast('الملف ده مش ملف إعدادات صالح');}
});

/* ================= ملف الذوق ================= */
// نفس النص بيتنسخ للـ AI يدوي وبيتبعت أوتوماتيك من زرار "رشّحلي" — وآخر سطر بيحدد شكل الرد عشان parseRecs تقراه
function tasteProfile(){
  const w=items.filter(i=>i.status==='watched'&&i.rating);
  const unrated=items.filter(i=>i.status==='watched'&&!i.rating);
  const dropped=items.filter(i=>i.status==='dropped');
  const liked=w.filter(i=>i.rating>=7), mixed=w.filter(i=>i.rating>=5&&i.rating<7), disliked=w.filter(i=>i.rating<5);
  const queue=items.filter(i=>i.status==='queue');
  const watching=items.filter(i=>i.status==='watching');
  // سطر واحد لكل عنوان: عنوان/ملاحظة فيها newlines (من نسخة احتياطية حد بعتها) متقدرش تكتب تعليمات جديدة للـ AI
  const one=s=>String(s).replace(/\s+/g,' ').trim();
  const line=i=>`- ${one(i.title)} (${i.type==='tv'?'TV':'Film'}${i.year?', '+i.year:''}${i.genre?', '+one(i.genre):''}) — my rating ${i.rating}/10${i.note?' — '+one(i.note):''}`;
  const qline=i=>`- ${one(i.title)} (${i.type==='tv'?'TV':'Film'}${i.year?', '+i.year:''}${i.genre?', '+one(i.genre):''})`;

  let txt='My taste profile:\n\n';
  txt+='LIKED (7-10):\n'+(liked.length?liked.map(line).join('\n'):'- (none yet)')+'\n\n';
  if(mixed.length)txt+='MIXED (5-6):\n'+mixed.map(line).join('\n')+'\n\n';
  txt+='DISLIKED (1-4):\n'+(disliked.length?disliked.map(line).join('\n'):'- (none yet)')+'\n\n';
  if(dropped.length)txt+='DROPPED (started but quit — strong negative signal):\n'+dropped.map(i=>qline(i)+(i.note?' — quit because: '+one(i.note):'')).join('\n')+'\n\n';
  if(unrated.length)txt+='ALSO WATCHED, NOT RATED (don\'t recommend these):\n'+unrated.map(qline).join('\n')+'\n\n';
  if(watching.length)txt+='CURRENTLY WATCHING (don\'t recommend these):\n'+watching.map(i=>qline(i)+` — at ${progLabel(i)}`).join('\n')+'\n\n';
  if(queue.length)txt+='CURRENTLY IN MY QUEUE (don\'t recommend these):\n'+queue.map(qline).join('\n')+'\n\n';
  txt+='Based on this taste profile, recommend 10 films or TV shows I haven\'t listed above.\n'
    +'Reply with ONLY a numbered list, one per line, exactly in this format:\n'
    +'1. Original English Title (Year) — one-line reason in Arabic, based on my likes and dislikes [because: Title A; Title B]\n'
    +'Inside [because: ...] put 1-3 titles copied exactly from my lists above that this pick is mainly based on, separated by ";".\n'
    +'No intro, no headings, no closing text.';
  return txt;
}

// "اترشح ليه": السبب + العناوين من قايمتك اللي الـ AI قال إنه بنى عليها (ببوسترها وتقييمك لو لقيناها عندك)
// المطابقة متسامحة: من غير حالة حروف ولا رموز ولا سنة بين قوسين، عشان الـ AI ساعات بيكتب العنوان بشكل مختلف شوية
const titleKey=t=>String(t).replace(/\([^)]*\)/g,'').toLowerCase().replace(/[^a-z0-9؀-ۿ]/g,'');
function recWhyHtml(why,from){
  const mine=(from||[]).map(t=>items.find(i=>titleKey(i.title)===titleKey(t))||{title:t});
  return (why?`<div dir="auto">${esc(why)}</div>`:'')
    +(mine.length?`<div class="rw-l">اترشح بناءً على ذوقك في:</div><div class="rw-chips">${mine.map(i=>
      `<span class="rw-chip">${i.poster?`<img src="${esc(i.poster)}" alt="">`:''}<span dir="auto">${esc(i.title)}</span>${i.rating?`<b>★${i.rating}</b>`:i.status==='dropped'?'<b>سبته</b>':''}</span>`).join('')}</div>`:'');
}
function impWhyToggle(ix){
  const box=document.querySelector(`.impWhyBox[data-ix="${ix}"]`), c=impCands[ix];
  if(!box||!c)return;
  box.hidden=!box.hidden;
  if(!box.hidden)box.innerHTML=recWhyHtml(c.why,c.from);
}

$('exportBtn').onclick=async()=>{
  const txt=tasteProfile();
  try{
    await navigator.clipboard.writeText(txt);
    toast('اتنسخ ✔ الصقه لأي AI وهيرشحلك');
  }catch(e){
    const ta=document.createElement('textarea');ta.value=txt;document.body.appendChild(ta);
    ta.select();document.execCommand('copy');ta.remove();
    toast('اتنسخ ✔');
  }
};

/* ================= Watch Party (الديسكتوب بس) =================
   الاتصال والتحكم في الفيديو في main/preload — هنا الواجهة بس.
   صاحبك بيتفرج على نسخة مؤقتة (_party) مبتتحفظش ومبتغيرش تقدّمه في قايمته */
const partyApi=window.__wlDesktop&&window.__wlDesktop.party;
let party={status:'idle',code:null,peers:0,media:null,error:null,enabled:false};
let partySavedSrv=null; // سيرفر المستخدم قبل الأوضة — بيرجع لما يخرج
const PARTY_ERRORS={room_full:'الأوضة مليانة (8 أشخاص بالكتير)',bad_code:'الكود ده مش صحيح — 8 حروف وأرقام',no_server:'Watch Party مش متاح في النسخة دي'};
const fmtCode=c=>c?c.slice(0,4)+'-'+c.slice(4):'';
// البروتوكول بيقبل لحد 31 — أي رقم برا الليستة الثابتة يبقى سيرفر 1، عشان محدش في الأوضة يشغّل القالب المخصص بتاعك
const partySrvOf=m=>Number.isInteger(m.srv)&&m.srv>=0&&m.srv<PLAYER_SERVERS.length?m.srv:0;

function partyMediaOf(it){
  const m={tmdbId:it.tmdbId,type:it.type==='tv'?'tv':'movie',srv:playerSrv,title:it.title};
  if(it.type==='tv'){m.season=it.curSeason||1;m.episode=(it.curEp||0)+1;}
  return m;
}
function itemMatchesMedia(it,m){
  if(!it||!m||it.tmdbId!==m.tmdbId||(it.type==='tv'?'tv':'movie')!==m.type||playerSrv!==partySrvOf(m))return false;
  return m.type!=='tv'||((it.curSeason||1)===m.season&&(it.curEp||0)+1===m.episode);
}
// البلاير اتفتح/اتغيّر عندي → بلّغ الأوضة (main بيتجاهل لو نفس الحلقة)
function partySyncMedia(it){
  if(!partyApi||party.status!=='connected'||mysteryMode||!it||!it.tmdbId)return;
  if(playerSrv>=PLAYER_SERVERS.length){
    // السيرفرات المخصصة متنفعش في الأوضة — صاحبك لازم يفتح نفس السيرفر من الليستة الثابتة
    if(partySavedSrv==null)partySavedSrv=playerSrv;
    playerSrv=0;toast('Watch Party بيشتغل على السيرفرات الأساسية بس — حوّلتك لسيرفر 1');
    renderModal();return; // renderModal هينادي partySyncMedia تاني بالسيرفر الجديد
  }
  partyApi.setMedia(partyMediaOf(it)).catch(()=>{});
}
// الأوضة اختارت فيلم/حلقة → افتحها عندي
function partyOpenMedia(m){
  const cur=items.find(i=>i.id===modalId);
  if(playerOpen&&itemMatchesMedia(cur,m))return;
  items=items.filter(i=>!i._party);
  const it={id:'party-'+m.tmdbId,title:m.title||'Watch Party',type:m.type==='tv'?'tv':'film',status:'party',_party:true,
    tmdbId:m.tmdbId,curSeason:m.season||1,curEp:(m.episode||1)-1,genre:'',note:'',added:Date.now()};
  items.push(it);
  if(partySavedSrv==null)partySavedSrv=playerSrv;
  playerSrv=partySrvOf(m);
  mysteryMode=false;mysteryId=null;
  modalId=it.id;playerOpen=true;
  $('overlay').classList.add('show');
  renderModal();
  toast('👥 الأوضة شغّالة: '+it.title);
}
function partyBadgeHtml(){
  if(!partyApi||!party.enabled)return'';
  const txt=party.status==='connected'?`👥 ${esc(fmtCode(party.code))} · ${party.peers}`
    :party.status==='connecting'||party.status==='reconnecting'?'👥 بيتصل...':'👥 Watch Party';
  return `<button class="srv${party.status==='connected'?' on':''}" data-act="partyOpen" title="Watch Party">${txt}</button>`;
}
function renderParty(){
  const badge=$('partyBadge');if(badge)badge.innerHTML=partyBadgeHtml(); // من غير renderModal — الـ iframe ميتعملوش reload
  const body=$('partyBody');if(!body)return;
  const err=party.error?`<div style="color:#ff7a7a;font-size:.85rem;margin-bottom:12px">${esc(PARTY_ERRORS[party.error]||'حصلت مشكلة — جرب تاني')}</div>`:'';
  if(!party.enabled){body.innerHTML=`<div class="sub">${PARTY_ERRORS.no_server}</div>`;return;}
  if(party.status==='idle'){
    body.innerHTML=err+`
      <button class="btn btn-amber" data-act="partyCreate" style="width:100%">＋ اعمل أوضة جديدة</button>
      <div class="sub" style="margin:10px 0 6px;text-align:center">أو ادخل أوضة صاحبك</div>
      <div style="display:flex;gap:6px">
        <input type="text" id="partyCode" dir="ltr" maxlength="9" placeholder="ABCD-EFGH" style="flex:1;text-transform:uppercase;letter-spacing:2px;text-align:center">
        <button class="btn" data-act="partyJoin">ادخل</button>
      </div>`;
    return;
  }
  if(party.status!=='connected'){
    body.innerHTML=err+`<div class="sub" style="margin-bottom:12px">${party.status==='reconnecting'?'النت فصل — بحاول أرجع تاني...':'بيتصل بالأوضة...'}</div>
      <button class="btn btn-ghost" data-act="partyLeave">إلغاء</button>`;
    return;
  }
  body.innerHTML=err+`
    <div style="text-align:center;margin-bottom:14px">
      <div class="sub">كود الأوضة — ابعته لصاحبك</div>
      <div dir="ltr" style="font-family:monospace;font-size:2rem;letter-spacing:4px;color:var(--amber);margin:6px 0">${esc(fmtCode(party.code))}</div>
      <button class="btn btn-sm" data-act="partyCopy">📋 انسخ الكود</button>
    </div>
    <div class="sub" style="margin-bottom:6px">👥 في الأوضة: ${party.peers}</div>
    <div class="sub" style="margin-bottom:14px">${party.media?'🎬 '+esc(party.media.title)+(party.media.type==='tv'?` — S${pad(party.media.season)}E${pad(party.media.episode)}`:''):'مستنيين حد يفتح فيلم أو حلقة من البلاير'}</div>
    ${party.media&&!(playerOpen&&itemMatchesMedia(items.find(i=>i.id===modalId),party.media))?`<button class="btn btn-amber" data-act="partyWatch" style="width:100%;margin-bottom:10px">▶ افتح البلاير</button>`:''}
    <button class="btn btn-ghost btn-danger" data-act="partyLeave">اخرج من الأوضة</button>`;
}
function partyOpen(){renderParty();$('partyOverlay').classList.add('show');}
function partyClose(){$('partyOverlay').classList.remove('show');}
$('partyOverlay').addEventListener('click',e=>{if(e.target===$('partyOverlay'))partyClose();});
async function partyCreate(){
  try{await partyApi.create();}catch(e){party.error=/no_server/.test(e.message)?'no_server':'x';renderParty();}
}
async function partyJoin(){
  const c=($('partyCode')&&$('partyCode').value)||'';
  try{await partyApi.join(c);}catch(e){party.error=/bad_code/.test(e.message)?'bad_code':/no_server/.test(e.message)?'no_server':'x';renderParty();}
}
async function partyLeave(){
  await partyApi.leave().catch(()=>{});
  const wasParty=items.some(i=>i._party&&i.id===modalId);
  items=items.filter(i=>!i._party);
  if(partySavedSrv!=null){playerSrv=partySavedSrv;partySavedSrv=null;}
  if(wasParty)closeModal();else if(modalId&&playerOpen)renderModal();
  party={...party,status:'idle',code:null,peers:0,media:null,error:null};
  renderParty();
}
async function partyCopy(){
  try{await navigator.clipboard.writeText(fmtCode(party.code));toast('الكود اتنسخ ✔ ابعته لصاحبك');}
  catch(e){toast('معرفتش أنسخ — الكود: '+fmtCode(party.code));}
}
if(partyApi){
  $('partyBtn').style.display='';
  partyApi.status().then(st=>{party=st;renderParty();}).catch(()=>{});
  partyApi.onStatus(st=>{
    const wasConnected=party.status==='connected';
    party={...st,enabled:party.enabled};
    // لسه داخل الأوضة ومحدش اختار حاجة، وأنا فاتح بلاير → اعرضه على الأوضة
    if(!wasConnected&&st.status==='connected'&&!st.media&&playerOpen)partySyncMedia(items.find(i=>i.id===modalId));
    renderParty();
  });
  partyApi.onMedia(m=>partyOpenMedia(m));
}

/* ================= توجيه الأحداث (MV3 CSP يمنع inline onclick) ================= */
document.addEventListener('click',(e)=>{
  const el=e.target.closest('[data-act]');
  if(!el)return;
  const id=el.dataset.id;
  switch(el.dataset.act){
    case 'open': openModal(id); break;
    case 'closeModal': closeModal(); break;
    case 'rate': setRating(id, parseInt(el.dataset.n)); break;
    case 'saveNote': saveNote(id); break;
    case 'watched': markWatched(id); break;
    case 'drop': markDropped(id); break;
    case 'toQueue': backToQueue(id); break;
    case 'edit': startEdit(id); break;
    case 'del': del(id); break;
    case 'watch': openWatch(id, parseInt(el.dataset.site)); break;
    case 'trailer': openTrailer(id); break;
    case 'ackSeason': ackSeason(id); break;
    case 'pick': pickResult(el.dataset.imdb); break;
    case 'saveKey': saveKey(); break;
    case 'saveTmdb': saveTmdb(); break;
    case 'addSite': addSite(); break;
    case 'delSite': delSite(parseInt(el.dataset.ix)); break;
    case 'backup': backup(); break;
    case 'restore': $('restoreFile').click(); break;
    case 'bkSnooze': bkSnooze(); break;
    case 'startWatch': startWatch(id); break;
    case 'epPlus': epPlus(id); break;
    case 'sMinus': stepProg(id,'s',-1); break;
    case 'sPlus': stepProg(id,'s',1); break;
    case 'eMinus': stepProg(id,'e',-1); break;
    case 'fType': filterType=el.dataset.v; render(); break;
    case 'fGenre': filterGenre=(filterGenre===el.dataset.v?null:el.dataset.v); render(); break;
    case 'fMore': genresOpen=!genresOpen; render(); break;
    case 'importParse': importParse(); break;
    case 'importAdd': importAdd(); break;
    case 'importClose': importClose(); break;
    case 'player': openPlayer(id); break;
    case 'playerClose': if(mysteryMode||String(modalId).startsWith('party-')){closeModal();}else{playerOpen=false;renderModal();} break;
    case 'playerNext': playerNext(id); break;
    case 'savePlayer': savePlayer(); break;
    case 'saveDl': saveDl(); break;
    case 'subLang': saveSubLang(el.dataset.v); break;
    case 'download': openDownload(id); break;
    case 'playerSrv': setPlayerSrv(parseInt(el.dataset.ix)); break;
    case 'playerSrvCycle': playerSrvCycle(parseInt(el.dataset.n)); break;
    case 'playerShield': togglePlayerShield(); break;
    case 'playerFs': playerFs(); break;
    case 'mysteryPlay': mysteryPlay(); break;
    case 'mysteryReveal': mysteryReveal(id); break;
    case 'mysteryStart': mysteryStart(); break;
    case 'mysteryClear': mysteryClear(); break;
    case 'playerPop': playerPop(id); break;
    case 'setExport': settingsExport(); break;
    case 'theme': setTheme(el.dataset.v); break;
    case 'settingsClose': closeSettings(); break;
    case 'statsClose': closeStats(); break;
    case 'moreToggle': {const m=$('moreActs');if(m)m.style.display=m.style.display==='none'?'flex':'none';} break;
    case 'setImport': $('setFile').click(); break;
    case 'partyOpen': partyOpen(); break;
    case 'partyClose': partyClose(); break;
    case 'partyCreate': partyCreate(); break;
    case 'partyJoin': partyJoin(); break;
    case 'partyLeave': partyLeave(); break;
    case 'partyCopy': partyCopy(); break;
    case 'partyWatch': partyClose(); partyOpenMedia(party.media); break;
    case 'aiSave': aiSave(); break;
    case 'aiClear': aiClear(); break;
    case 'aiRun': aiRun(); break;
    case 'aiModels': aiFetchModels(); break;
    case 'aiTest': aiTest(); break;
    case 'impWhy': e.preventDefault(); impWhyToggle(parseInt(el.dataset.ix)); break;
  }
});
// "/" يوصلك للبحث فوراً
document.addEventListener('keydown',e=>{
  if(e.key==='/'&&document.activeElement.tagName!=='INPUT'&&document.activeElement.tagName!=='TEXTAREA'){
    e.preventDefault();$('search').focus();
  }
});
// دخول بالكيبورد على الكروت
document.addEventListener('keydown',(e)=>{
  if(e.key!=='Enter')return;
  const el=e.target.closest('[data-act="open"]');
  if(el)openModal(el.dataset.id);
});
// البوستر اللي يفشل تحميله يتشال بهدوء (error مبيعملش bubble فبنستخدم capture)
document.addEventListener('error',(e)=>{
  const img=e.target;
  if(img.tagName!=='IMG')return;
  if(img.closest('.pcard')){
    const card=img.closest('.pcard');
    img.remove();
    if(!card.querySelector('.noimg')){
      const it=items.find(i=>i.id===card.dataset.itemid);
      card.insertAdjacentHTML('afterbegin',
        `<div class="noimg"><span class="fi">🎞</span><span class="nt" dir="auto">${esc(it?it.title:'')}</span></div>`);
    }
  }else{
    img.remove();
  }
},true);

load().then(()=>{
  if(location.search.includes('settings=1'))openSettings();
});
