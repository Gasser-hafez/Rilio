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
let items=[], sites=[], tab='queue';
let sortDesc=true, queueSort='manual', modalId=null;
let selfWrites=0;
let filterType='all', filterGenre=null, statsOpen=false, impCands=[], playerOpen=false, genresOpen=false;
let mysteryMode=false, mysteryId=null, track=null; // track = تتبع الحلقة اللي في البلاير
const DEFAULT_PLAYER='https://vidsrc-embed.ru/embed/{type}?tmdb={tmdbID}&season={season}&episode={episode}';
const PLAYER_SERVERS=[
  {name:'سيرفر 1', tpl:'https://vsembed.ru/embed/{type}?tmdb={tmdbID}&season={season}&episode={episode}'},
  {name:'سيرفر 2', tpl:'https://vidsrc.cc/v2/embed/{type}/{tmdbID}/{season}/{episode}'},
  {name:'سيرفر 3', tpl:'https://player.embed-api.stream/?id={tmdbID}&s={season}&e={episode}'},
  {name:'سيرفر 4', tpl:'https://vidlink.pro/{type}/{tmdbID}/{season}/{episode}'}
];
// "مخصص" = رقم بعد آخر سيرفر في الليستة — فبنخزّن طول الليستة وقت الحفظ،
// عشان لما سيرفر جديد يتضاف، اللي كان مختار "مخصص" ميتحوّلش للسيرفر الجديد من غير ما يعرف
const SRV_LIST_LEN_KEY='watchlist:srvListLen';
const LEGACY_SRV_LIST_LEN=3; // قبل ما نبدأ نخزّن الطول (لحد 4.3.0)
function restorePlayerSrv(saved,savedLen){
  const ix=parseInt(saved||'0')||0;
  const len=parseInt(savedLen||'')||LEGACY_SRV_LIST_LEN;
  return ix>=len?PLAYER_SERVERS.length:Math.min(ix,PLAYER_SERVERS.length);
}
let playerSrv=0, playerShield=true, subLang='ar';
const DEFAULT_DL='https://web.nxsha.app/dl/{type}/{tmdbID}/{season}/{episode}';
const LEGACY_DL='https://web.nxsha.app/dl/{type}/{tmdbID}'; // كان بيفتح S1E1 دايماً للمسلسلات

/* ================= أدوات ================= */
const $=id=>document.getElementById(id);
// الديسكتوب: شريط النافذة بتاعنا بيظهر بدل بتاع ويندوز
if(window.__wlDesktop)document.documentElement.classList.add('desktop');

/* ================= الأيقونات (SVG خطية — نصوص ثابتة، مفيهاش بيانات يوزر) ================= */
const ICONS={
  play:'<path d="M7 4.5v15l12-7.5z"/>',
  check:'<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  x:'<path d="M6 6l12 12M18 6L6 18"/>',
  search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  spark:'<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  chart:'<path d="M5 20V11M12 20V4M19 20v-6"/>',
  sliders:'<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  users:'<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.2A5 5 0 0 1 21.5 19"/>',
  dice:'<rect x="3" y="3" width="18" height="18" rx="4"/><path stroke-width="3" d="M8.5 8.5h.01M15.5 15.5h.01M15.5 8.5h.01M8.5 15.5h.01"/>',
  sort:'<path d="M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4"/>',
  grid:'<rect x="3" y="3" width="7" height="9" rx="2"/><rect x="14" y="3" width="7" height="9" rx="2"/><rect x="3" y="15" width="7" height="6" rx="2"/><rect x="14" y="15" width="7" height="6" rx="2"/>',
  list:'<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  moon:'<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  gift:'<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
  bell:'<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  download:'<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  upload:'<path d="M12 21V9M7 14l5-5 5 5M5 3h14"/>',
  film:'<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M10 9.5v5l4-2.5z"/>',
  undo:'<path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5"/>',
  edit:'<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  trash:'<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  more:'<path stroke-width="3" d="M5 12h.01M12 12h.01M19 12h.01"/>',
  server:'<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
  expand:'<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  window:'<rect x="3" y="7" width="14" height="14" rx="2"/><path d="M7 3h14v14"/>',
  eye:'<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  copy:'<rect x="8" y="8" width="12" height="12" rx="3"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  bulb:'<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.8 10.6c.6.5.8 1.2.8 1.9V16h6v-.5c0-.7.3-1.4.8-1.9A6 6 0 0 0 12 3z"/>',
  shield:'<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  refresh:'<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8M21 3v5h-5"/>',
  flask:'<path d="M9 3h6M10 3v6L4.5 18.5A2 2 0 0 0 6.2 21h11.6a2 2 0 0 0 1.7-2.5L14 9V3"/>',
  star:'<path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  bookmark:'<path d="M6 3h12v18l-6-4-6 4z"/>',
  alert:'<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>',
  ext:'<path d="M7 17L17 7M9 7h8v8"/>',
  clipboard:'<path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/>',
  github:'<path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.9a3.4 3.4 0 0 0-.9-2.6c3-.3 6.2-1.5 6.2-6.7a5.2 5.2 0 0 0-1.4-3.6 4.8 4.8 0 0 0-.1-3.6s-1.2-.3-3.8 1.4a13 13 0 0 0-7 0C6.4 1.6 5.2 1.9 5.2 1.9a4.8 4.8 0 0 0-.1 3.6 5.2 5.2 0 0 0-1.4 3.6c0 5.2 3.2 6.4 6.2 6.7a3.4 3.4 0 0 0-.9 2.6V22"/>'
};
const ic=(n,cls='')=>`<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n]||''}</svg>`;
document.querySelectorAll('i[data-ic]').forEach(el=>{el.outerHTML=ic(el.dataset.ic,el.className);});
// بوستر بديل لما مفيش صورة: لون ثابت من الاسم نفسه
const hue=t=>{let h=0;for(const c of String(t))h=(h*31+c.codePointAt(0))%360;return h;};
const noimgHtml=(it,withTitle=true)=>`<div class="noimg" style="--h:${hue(it?it.title:'')}">${withTitle?`<span class="nt" dir="auto">${esc(it?it.title:'')}</span>`:''}</div>`;
{const h=new Date().getHours(), morning=h>=5&&h<12;
  $('hello').textContent=morning?'صباح الخير':'مساء الخير';
  document.querySelector('.hello .ic').outerHTML=ic(morning?'sun':'moon');}
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
  // Rotten Tomatoes: نسبة صحيحة 0-100. rtChecked = سألنا OMDb خلاص (حتى لو مفيش تقييم) عشان منسألش تاني
  {const r=num(it.rt);out.rt=r!=null&&Number.isInteger(r)&&r<=100?r:null;}
  out.rtChecked=it.rtChecked===true;
  out.imdbID=/^tt\d+$/.test(str(it.imdbID))?it.imdbID:null;
  out.poster=isHttp(it.poster)?it.poster:null;
  // backdrop مسار TMDB زي /abc.jpg، و'' معناها "جربنا وملقيناش"
  out.backdrop=it.backdrop===''?'':/^\/[\w.-]+$/.test(str(it.backdrop))?it.backdrop:null;
  out.newSeason=it.newSeason===true;
  // سبب الترشيح (لو جه من الـ AI) — undefined بيتشال من الـ JSON فالعناصر العادية متكبرش
  out.recWhy=str(it.recWhy).slice(0,300)||undefined;
  out.recFrom=Array.isArray(it.recFrom)?it.recFrom.filter(t=>typeof t==='string'&&t).slice(0,5).map(t=>t.slice(0,120)):[];
  if(!out.recFrom.length)out.recFrom=undefined;
  // مكان الوقوف في البلاير: {pos} للفيلم، {s,e,pos} للحلقة — أرقام بس
  {const r=it.resume;out.resume=r&&typeof r==='object'&&num(r.pos)!=null?{pos:num(r.pos),s:num(r.s),e:num(r.e),dur:num(r.dur),at:num(r.at)}:undefined;}
  // الحلقة الجاية من TMDB (تاريخ YYYY-MM-DD) + آخر حلقة نزلت واتبعت عنها إشعار ("2x5")
  {const n=it.nextEp;out.nextEp=n&&typeof n==='object'&&num(n.s)!=null&&num(n.e)!=null&&/^\d{4}-\d{2}-\d{2}$/.test(str(n.date))?{s:num(n.s),e:num(n.e),date:n.date}:undefined;}
  out.epNotified=/^\d{1,3}x\d{1,4}$/.test(str(it.epNotified))?it.epNotified:undefined;
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
  return Array.isArray(arr)?arr.filter(s=>s&&isHttp(s.url)).map(s=>({name:str(s.name)||s.url,url:s.url,...(s.noBlock===true?{noBlock:true}:{}),...(s.dl===true?{dl:true}:{})})):null;
}

/* ================= نافذة تأكيد جوه البرنامج =================
   بدل confirm/alert بتوع ويندوز (شكلهم غريب عن البرنامج) — بترجع Promise<boolean> */
let confirmResolve=null;
function uiConfirm(msg,{yes='أيوه',no='لأ',danger=false}={}){
  if(confirmResolve)confirmDone(false); // تأكيد قديم مفتوح = اتلغى
  $('confirmMsg').textContent=msg;
  $('confirmYes').textContent=yes;$('confirmNo').textContent=no;
  $('confirmYes').className='btn '+(danger?'btn-dangerfill':'btn-amber'); // حذف = زرار أحمر واضح
  $('confirmOverlay').classList.add('show');
  setTimeout(()=>$('confirmNo').focus(),0); // الافتراضي "لأ" — Enter بالغلط ميمسحش حاجة
  return new Promise(r=>{confirmResolve=r;});
}
function confirmDone(v){
  if(!confirmResolve)return;
  const r=confirmResolve;confirmResolve=null;
  $('confirmOverlay').classList.remove('show');
  r(v);
}
$('confirmYes').onclick=()=>confirmDone(true);
$('confirmNo').onclick=()=>confirmDone(false);
$('confirmOverlay').addEventListener('click',e=>{if(e.target===$('confirmOverlay'))confirmDone(false);});

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
  $('apiKey').value=(await sget('watchlist:omdbkey'))||'';
  $('tmdbKey').value=(await sget('watchlist:tmdbkey'))||'';
  $('playerTpl').value=(await sget('watchlist:playerTpl'))||DEFAULT_PLAYER;
  {const d=await sget('watchlist:dlTpl');$('dlTpl').value=!d||d===LEGACY_DL?DEFAULT_DL:d;}
  playerSrv=restorePlayerSrv(await sget('watchlist:playerSrv'),await sget(SRV_LIST_LEN_KEY));
  playerShield=(await sget('watchlist:playerShield'))==='1';
  $('adblockBtn').setAttribute('aria-checked',(await sget('watchlist:adblock'))==='0'?'false':'true');
  subLang=(await sget('watchlist:subLang'));if(subLang==null)subLang='ar';
  {const stored=await sget('watchlist:theme'), t=applyTheme(stored);
    if(stored&&stored!==t)await sset('watchlist:theme',t);} // الثيمات القديمة بتتحول للمزاج المقابل مرة واحدة
  try{const s=await sget('watchlist:sites');sites=s?parseSites(s):null;}catch(e){sites=null;}
  if(!sites){sites=DEFAULT_SITES.slice();await sset('watchlist:sites',JSON.stringify(sites));}
  statsOpen=(await sget('watchlist:statsOpen'))==='1';
  renderSites();
  render();
  aiLoad();
  checkSeasons();
  checkBackupDue();
  setTimeout(rtBackfill,20000);
  startOnboarding();
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

/* ================= الأمزجة ================= */
// القيمة جاية من التخزين أو ملف إعدادات حد بعته — بتتقبل بس من الليستة
const THEMES=['sahra','mint','coffee','sunrise'];
const THEME_OLD={cinema:'sahra',nova:'sahra',midnight:'mint',ember:'coffee'};
function applyTheme(t){
  t=THEME_OLD[t]||t;
  if(!THEMES.includes(t))t='sahra';
  if(t==='sahra')delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme=t;
  document.querySelectorAll('.theme-card').forEach(c=>c.classList.toggle('on',c.dataset.v===t));
  if(window.__wlDesktop&&window.__wlDesktop.titlebar)window.__wlDesktop.titlebar(t).catch(()=>{});
  return t;
}
async function setTheme(t){
  await sset('watchlist:theme',applyTheme(t));
  toast('المزاج اتغيّر ✔');
}

/* ================= مودال الإعدادات ================= */
function openSettings(page){
  shieldLabel();
  document.querySelectorAll('#subLangs .sl').forEach(b=>b.classList.toggle('on',b.dataset.v===(subLang||'ar')));
  renderDefSrv();
  setNav(typeof page==='string'?page:'pgGeneral');
  $('settingsOverlay').classList.add('show');
}
// كل قسم صفحة لوحده — القايمة الجانبية بتبدّل الصفحة بدل ما تنزل في صفحة طويلة
function setNav(id){
  const page=$(id);if(!page||!page.classList.contains('spage'))return;
  document.querySelectorAll('#setBody .spage').forEach(p=>{p.hidden=p!==page;});
  document.querySelectorAll('.setnav button').forEach(b=>b.classList.toggle('on',b.dataset.v===id));
  $('setBody').scrollTop=0;
  if(id==='pgKeys')refreshKeyStatus();
}

/* ---- المفاتيح ---- */
const KEY_BADGE={ok:['ok','✓ شغال'],bad:['bad','✗ مش شغال'],limit:['warn','خلص حده النهارده'],offline:['warn','مش متأكد — مفيش نت؟'],none:['bad','مش متسجّل'],shared:['soft','المفتاح المشترك'],checking:['soft','بيتأكد...']};
function keyBadge(el,st){const [cls,txt]=KEY_BADGE[st];el.className='kbadge '+cls;el.textContent=txt;}
let keyCheckSeq=0;
async function refreshKeyStatus(){
  const seq=++keyCheckSeq;
  const tmdb=(await sget('watchlist:tmdbkey'))||'', omdb=(await sget('watchlist:omdbkey'))||'';
  $('tmdbKey').value=tmdb;$('apiKey').value=omdb;
  $('tmdbStat').textContent='';$('omdbStat').textContent='';
  $('keySharedBtn').hidden=!omdb;
  keyBadge($('tmdbBadge'),tmdb?'checking':'none');
  keyBadge($('omdbBadge'),omdb?'checking':'shared');
  const [a,b]=await Promise.all([tmdb?checkTmdbKey(tmdb):null,omdb?checkOmdbKey(omdb):null]);
  if(seq!==keyCheckSeq)return; // اتفتحت تاني في النص
  if(a)keyBadge($('tmdbBadge'),a);
  if(b)keyBadge($('omdbBadge'),b);
}
async function keySave(kind){
  const input=$(kind==='tmdb'?'tmdbKey':'apiKey'), stat=$(kind==='tmdb'?'tmdbStat':'omdbStat');
  if(kind==='omdb'&&!input.value.trim())return keyShared();
  const st=await saveCheckedKey(kind,input.value,stat);
  if(st==='ok'||st==='limit'){keyBadge($(kind==='tmdb'?'tmdbBadge':'omdbBadge'),st);if(kind==='omdb')$('keySharedBtn').hidden=false;}
}
async function keyShared(){
  await sset('watchlist:omdbkey','');
  $('apiKey').value='';$('keySharedBtn').hidden=true;
  keyBadge($('omdbBadge'),'shared');
  keyStat($('omdbStat'),'ok');$('omdbStat').textContent='✓ رجعت للمفتاح المشترك';
}

/* ---- المشاهدة ---- */
// السيرفر الافتراضي: نفس playerSrv اللي البلاير بيبدّله، و"مخصص" بيظهر بس لو فيه قالب غير الافتراضي
function renderDefSrv(){
  const custom=$('playerTpl').value.trim();
  const opts=PLAYER_SERVERS.map((s,ix)=>({ix,name:s.name}));
  if(custom&&custom!==DEFAULT_PLAYER)opts.push({ix:PLAYER_SERVERS.length,name:'مخصص'});
  $('defSrv').innerHTML=opts.map(o=>`<button class="sl${o.ix===playerSrv?' on':''}" role="radio" aria-checked="${o.ix===playerSrv}" data-act="defSrv" data-ix="${o.ix}">${esc(o.name)}</button>`).join('');
}
async function defSrv(ix){
  if(!Number.isInteger(ix)||ix<0||ix>PLAYER_SERVERS.length)return;
  playerSrv=ix;
  await sset('watchlist:playerSrv',String(ix));
  await sset(SRV_LIST_LEN_KEY,String(PLAYER_SERVERS.length));
  renderDefSrv();
  if(modalId&&playerOpen)renderModal();
  toast('السيرفر الافتراضي اتغيّر ✔');
}
// القوالب بتتحفظ لوحدها لما تخرج من الخانة — لينك http(s) فيه رقم الفيلم، وإلا خطأ تحت الخانة ومبيتحفظش
function bindTemplate(inputId,errId,storeKey,def){
  $(inputId).addEventListener('change',async()=>{
    const v=$(inputId).value.trim();
    if(v&&(!isHttp(v)||!/\{(tmdbID|imdbID|q)\}/.test(v))){
      $(errId).textContent='لازم يكون لينك يبدأ بـ https:// وفيه {tmdbID} أو {imdbID}';
      return;
    }
    $(errId).textContent='';
    await sset(storeKey,v);
    if(!v)$(inputId).value=def;
    if(inputId==='playerTpl')renderDefSrv();
    toast('اتحفظ ✔');
  });
}
bindTemplate('playerTpl','playerTplErr','watchlist:playerTpl',DEFAULT_PLAYER);
bindTemplate('dlTpl','dlTplErr','watchlist:dlTpl',DEFAULT_DL);
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
    const fresh=[], airedEps=[];
    const today=new Date().toISOString().slice(0,10);
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
        // مواعيد الحلقات (للي بتتفرج عليه بس): الجاية للشارة على الكارت، وآخر واحدة نزلت للإشعار
        if(it.status==='watching'){
          const nx=d.next_episode_to_air, ls=d.last_episode_to_air;
          const nextEp=nx&&Number.isInteger(nx.season_number)&&Number.isInteger(nx.episode_number)&&/^\d{4}-\d{2}-\d{2}$/.test(str(nx.air_date))
            ?{s:nx.season_number,e:nx.episode_number,date:nx.air_date}:undefined;
          if(JSON.stringify(nextEp)!==JSON.stringify(it.nextEp)){it.nextEp=nextEp;changed=true;}
          if(ls&&Number.isInteger(ls.season_number)&&Number.isInteger(ls.episode_number)&&str(ls.air_date)&&ls.air_date<=today){
            const k=ls.season_number+'x'+ls.episode_number;
            if(it.epNotified!==k){
              // أول مرة بنشوف المسلسل: نسجّل من غير إشعار. وموسم جديد ليه إشعاره لوحده
              if(it.epNotified!=null&&!fresh.includes(it))airedEps.push({it,s:ls.season_number,e:ls.episode_number});
              it.epNotified=k;changed=true;
            }
          }
        }
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
    if(airedEps.length===1){
      const {it,s,e}=airedEps[0];
      notifyDesktop({title:'🎬 حلقة جديدة نزلت',body:`${it.title} — S${pad(s)}E${pad(e)}`,itemId:it.id});
    }else if(airedEps.length>1){
      notifyDesktop({title:`🎬 ${airedEps.length} حلقات جديدة نزلت`,body:airedEps.map(x=>`${x.it.title} S${pad(x.s)}E${pad(x.e)}`).join('، ')});
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

/* ================= الإضافة السريعة: سيرش لايف ================= */
// بتكتب الاسم ← النتايج بتطلع وانت بتكتب ← "هشوفه" أو "شفته"
// المصدر TMDB (سريع وبوسترات أحسن)، ولو مفيش مفتاح TMDB بنرجع لـ OMDb
let qaTimer=null, qaReq=0;
const qaCache=new Map(), qaRows=new Map();
// اللي اتضاف من البحث في الجلسة دي (key → id) — بيظهرله "تراجع" بدل ما تروح للقايمة تمسحه
const qaAdded=new Map();
const TMDB_PATH=/^\/[\w.-]+$/;
function addOpen(){
  const box=$('quickAdd'), q=$('search').value.trim();
  box.hidden=false;
  if(q&&!$('qaInput').value){$('qaInput').value=q;qaSearch();}
  box.scrollIntoView({behavior:'smooth',block:'center'});
  $('qaInput').focus({preventScroll:true});
}
function qaClose(){
  $('quickAdd').hidden=true;$('qaInput').value='';$('qaResults').innerHTML='';
  clearTimeout(qaTimer);qaReq++;$('qaSpin').hidden=true;
}
$('qaInput').addEventListener('input',()=>{clearTimeout(qaTimer);qaTimer=setTimeout(qaSearch,300);});
$('qaInput').addEventListener('keydown',e=>{if(e.key==='Enter'){clearTimeout(qaTimer);qaSearch();}});
const omdbKey=async()=>(await sget('watchlist:omdbkey'))||DEFAULT_OMDB_KEY;
// تقييم Rotten Tomatoes من نفس رد OMDb (Ratings) — "94%" → 94
function rtOf(m){
  const r=m&&Array.isArray(m.Ratings)?m.Ratings.find(x=>x&&x.Source==='Rotten Tomatoes'):null;
  const v=r&&/^(\d{1,3})%$/.exec(str(r.Value));
  return v&&+v[1]<=100?+v[1]:null;
}
const rtHtml=(it,cls)=>it.rt!=null?`<span class="${cls}" title="Rotten Tomatoes">🍅 ${it.rt}%</span>`:'';
// العناصر القديمة: تقييم RT بيتجاب في الخلفية واحدة واحدة — OMDb المجاني محدود (1000 طلب في اليوم)
// العناصر اللي جت من TMDB من غير رقم IMDb: بنجيب الرقم من TMDB الأول (OMDb محتاجه)
const RT_BACKFILL_MAX=150, RT_BACKFILL_GAP_MS=1500;
async function rtBackfill(){
  const todo=items.filter(i=>!i.rtChecked&&!i._party&&(i.imdbID||i.tmdbId)).slice(0,RT_BACKFILL_MAX);
  if(!todo.length)return;
  const key=await omdbKey();
  let changed=0;
  for(const it of todo){
    try{
      const cur=items.find(i=>i.id===it.id);if(!cur)continue;
      if(!cur.imdbID&&cur.tmdbId){
        const ex=await tmdbFetch(`/${cur.type==='tv'?'tv':'movie'}/${cur.tmdbId}/external_ids`).catch(e=>{if(e.message==='NO_KEY'||e.message==='BAD_KEY')throw e;return {};});
        if(/^tt\d+$/.test(str(ex.imdb_id)))cur.imdbID=ex.imdb_id;
        else{cur.rtChecked=true;changed++;continue;} // مفيش رقم IMDb خالص — منسألش تاني
      }
      const m=await(await fetch(`https://www.omdbapi.com/?apikey=${encodeURIComponent(key)}&i=${encodeURIComponent(cur.imdbID)}`,{signal:AbortSignal.timeout(20000)})).json();
      if(m.Response==='False'&&/key|limit/i.test(str(m.Error)))break; // مفتاح غلط أو الحد اليومي خلص
      cur.rt=rtOf(m);cur.rtChecked=true;changed++;
      if(!cur.imdb&&parseFloat(m.imdbRating))cur.imdb=parseFloat(m.imdbRating);
      if(changed%10===0){await persist();render();} // يبان أول بأول مش في الآخر بس
    }catch(e){break;} // من غير نت أو من غير مفتاح TMDB: نكمّل المرة الجاية
    await new Promise(r=>setTimeout(r,RT_BACKFILL_GAP_MS));
  }
  if(changed){await persist();render();}
}
// كل اللي جاي من TMDB/OMDb بيتنضف هنا: أرقام بس، بوستر بمسار صالح، والنصوص بتتعمل esc وقت العرض
async function qaFetch(q){
  if(await sget('watchlist:tmdbkey')){
    const d=await tmdbFetch(`/search/multi?query=${encodeURIComponent(q)}&include_adult=false`);
    return (d.results||[]).filter(r=>(r.media_type==='movie'||r.media_type==='tv')&&Number.isInteger(r.id)).slice(0,8).map(r=>({
      key:`tm-${r.media_type}-${r.id}`,src:'tmdb',tmdbId:r.id,tv:r.media_type==='tv',
      title:str(r.title||r.name),year:str(r.release_date||r.first_air_date).slice(0,4),
      poster:TMDB_PATH.test(str(r.poster_path))?'https://image.tmdb.org/t/p/w154'+r.poster_path:null,
      posterBig:TMDB_PATH.test(str(r.poster_path))?'https://image.tmdb.org/t/p/w342'+r.poster_path:null,
      backdrop:TMDB_PATH.test(str(r.backdrop_path))?r.backdrop_path:null,desc:str(r.overview)}));
  }
  const data=await(await fetch(`https://www.omdbapi.com/?apikey=${encodeURIComponent(await omdbKey())}&s=${encodeURIComponent(q)}`)).json();
  if(data.Error==='Invalid API key!')throw new Error('KEY');
  return (data.Search||[]).filter(r=>(r.Type==='movie'||r.Type==='series')&&/^tt\d+$/.test(r.imdbID)).slice(0,8).map(r=>({
    key:r.imdbID,src:'omdb',imdbID:r.imdbID,tv:r.Type==='series',title:str(r.Title),year:str(r.Year).slice(0,4),
    poster:isHttp(r.Poster)?r.Poster:null}));
}
async function qaSearch(){
  const q=$('qaInput').value.trim(), n=++qaReq;
  if(q.length<2){$('qaResults').innerHTML='';$('qaSpin').hidden=true;return;}
  $('qaSpin').hidden=false;
  try{
    let list=qaCache.get(q.toLowerCase());
    if(!list){list=await qaFetch(q);qaCache.set(q.toLowerCase(),list);}
    if(n!==qaReq)return; // اتكتب حاجة أحدث وانا مستني
    qaRender(list);
  }catch(e){
    if(n!==qaReq)return;
    $('qaResults').innerHTML=`<div class="qa-hint">${e.message==='KEY'?'مفتاح OMDb غلط — راجعه في الإعدادات':e.message==='BAD_KEY'?'مفتاح TMDB غلط — راجعه في الإعدادات':'مقدرتش أدوّر دلوقتي — اتأكد من النت'}</div>`;
  }finally{if(n===qaReq)$('qaSpin').hidden=true;}
}
const qaOwned=r=>items.find(i=>r.src==='tmdb'?(i.tmdbId===r.tmdbId&&(i.type==='tv')===r.tv):i.imdbID===r.imdbID);
function qaRender(list){
  if(!list.length){$('qaResults').innerHTML='<div class="qa-hint">ملقتش حاجة بالاسم ده — جرّب تكتبه بالإنجليزي أو أدق</div>';return;}
  list.forEach(r=>qaRows.set(r.key,r));
  $('qaResults').innerHTML=list.map(r=>{
    const own=qaOwned(r);
    return `<div class="qa-row${own?' added':''}" data-key="${esc(r.key)}">
      <div class="qa-p">${ic('film')}${r.poster?`<img src="${esc(r.poster)}" alt="" loading="lazy">`:''}</div>
      <div class="qa-info">
        <div class="qa-t" dir="auto">${esc(r.title)}</div>
        <div class="qa-m">${r.tv?'مسلسل':'فيلم'}${r.year?' · '+esc(r.year):''}</div>
      </div>
      <div class="qa-acts">${qaActsHtml(r,own)}</div>
    </div>`;
  }).join('');
}
function qaActsHtml(r,own){
  const k=esc(r.key);
  if(own&&qaAdded.get(r.key)===own.id)
    return `<span class="qa-own">${ic('check','sm')}اتضاف</span><button class="btn btn-sm btn-ghost" data-act="qaUndo" data-key="${k}" title="شيله من القايمة">تراجع</button>`;
  if(own)return `<span class="qa-own">${ic('check','sm')}في قايمتك</span>`;
  return `<button class="btn btn-sm btn-amber" data-act="qaAdd" data-key="${k}" data-s="queue">${ic('plus','sm')}هشوفه</button>
          <button class="btn btn-sm" data-act="qaAdd" data-key="${k}" data-s="watched">${ic('check','sm')}شفته</button>`;
}
const qaRowEl=key=>document.querySelector(`.qa-row[data-key="${CSS.escape(key)}"]`);
// التراجع: بيشيل اللي اتضاف من نفس الصف، من غير تأكيد (التراجع نفسه هو التأكيد)
async function qaUndo(key){
  const id=qaAdded.get(key);if(!id)return;
  qaAdded.delete(key);
  items=items.filter(i=>i.id!==id);
  if(modalId===id)closeModal();
  await persist();render();
  const row=qaRowEl(key),r=qaRows.get(key);
  if(row&&r){row.classList.remove('added');row.querySelector('.qa-acts').innerHTML=qaActsHtml(r,null);}
  toast('اتشال من القايمة');
}
// تقييم IMDb من OMDb بييجي في الخلفية — الإضافة نفسها متستناهوش (OMDb ساعات بيتأخر جداً)
async function qaFillImdb(it){
  if(!it.imdbID)return;
  try{
    const m=await(await fetch(`https://www.omdbapi.com/?apikey=${encodeURIComponent(await omdbKey())}&i=${encodeURIComponent(it.imdbID)}`,{signal:AbortSignal.timeout(60000)})).json();
    if(m.Response!=='True')return;
    const cur=items.find(i=>i.id===it.id);if(!cur)return;
    cur.imdb=parseFloat(m.imdbRating)||cur.imdb||null;
    cur.rt=rtOf(m)??cur.rt??null;cur.rtChecked=true;
    if(!cur.genre&&m.Genre&&m.Genre!=='N/A')cur.genre=m.Genre;
    await persist();render();if(modalId===cur.id&&!playerOpen)renderModal();
  }catch(e){}
}
async function qaAdd(key,status){
  const r=qaRows.get(key);
  if(!r||!['queue','watched'].includes(status))return;
  if(qaOwned(r)){toast('موجود في قايمتك بالفعل');return;}
  const row=qaRowEl(key);
  row?.querySelectorAll('button').forEach(b=>b.disabled=true);
  try{
    let raw;
    if(r.src==='tmdb'){
      const d=await tmdbFetch(`/${r.tv?'tv':'movie'}/${r.tmdbId}?append_to_response=external_ids`);
      raw={title:d.title||d.name||r.title,genre:(d.genres||[]).map(g=>str(g.name)).filter(Boolean).join(', '),
        year:parseInt(str(d.release_date||d.first_air_date).slice(0,4))||parseInt(r.year)||null,desc:str(d.overview)||r.desc,
        poster:r.posterBig,backdrop:TMDB_PATH.test(str(d.backdrop_path))?d.backdrop_path:r.backdrop,tmdbId:r.tmdbId,
        imdbID:str(d.external_ids&&d.external_ids.imdb_id),imdb:null};
    }else{
      const m=await(await fetch(`https://www.omdbapi.com/?apikey=${encodeURIComponent(await omdbKey())}&i=${encodeURIComponent(r.imdbID)}&plot=short`)).json();
      if(m.Response!=='True')throw new Error('x');
      raw={title:m.Title,genre:m.Genre&&m.Genre!=='N/A'?m.Genre:'',year:parseInt(str(m.Year).slice(0,4))||null,
        imdb:parseFloat(m.imdbRating)||null,rt:rtOf(m),rtChecked:true,desc:m.Plot&&m.Plot!=='N/A'?m.Plot:'',poster:m.Poster&&m.Poster!=='N/A'?m.Poster:null,imdbID:r.imdbID};
    }
    const it=cleanItem({id:uid(),type:r.tv?'tv':'film',status,rating:null,note:'',added:Date.now(),order:Date.now(),
      watchedAt:status==='watched'?Date.now():null,...raw});
    if(!it)throw new Error('x');
    items.unshift(it);
    qaAdded.set(key,it.id);
    await persist();
    tab=status;render();
    if(row){row.classList.add('added');row.querySelector('.qa-acts').innerHTML=qaActsHtml(r,it);}
    if(status==='watched'){openModal(it.id);toast('اتضاف لـ"شفتهم" — قيّمه');}
    else toast('اتضاف لـ"هشوفهم" ✔');
    if(r.src==='tmdb')qaFillImdb(it);
  }catch(e){
    row?.querySelectorAll('button').forEach(b=>b.disabled=false);
    toast(e.message==='BAD_KEY'?'مفتاح TMDB غلط — راجعه في الإعدادات':'حصلت مشكلة في جلب التفاصيل — جرب تاني');
  }
}

/* ================= الشريط ================= */
document.querySelectorAll('.tab').forEach(b=>{
  b.onclick=()=>{tab=b.dataset.tab;filterGenre=null;render();};
});
$('gearBtn').onclick=openSettings;
$('statsToggle').onclick=()=>{openStats();};
$('search').oninput=()=>render();


// الفيلم الغامض: اختيار عشوائي من "هشوفهم"، والأعلى على IMDb فرصته أكبر
function weightedPick(pool){
  const weights=pool.map(i=>Math.pow(i.imdb||6,2));
  let r=Math.random()*weights.reduce((a,b)=>a+b,0);
  for(let j=0;j<pool.length;j++){r-=weights[j];if(r<=0)return pool[j];}
  return pool[0];
}
$('sortBtn').onclick=()=>{
  if(tab==='watched'){sortDesc=!sortDesc;}
  else{queueSort=queueSort==='manual'?'added':queueSort==='added'?'imdbDesc':queueSort==='imdbDesc'?'imdbAsc':'manual';}
  render();
};

/* ================= لوحة الإحصائيات والرؤى ================= */
function openStats(){buildStats();$('statsOverlay').classList.add('show');}
function closeStats(){flushWatch();$('statsOverlay').classList.remove('show');}
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

  const RAMP=['#FF7A9A','#FF7A9A','#FF8A80','#FF9466','#FFAA6A','#FFC56E','#FFD36E','#C9E08A','#9BE4A8','#6EE7C8'];
  let html=`<div class="stat-cards">
    <div class="stat-card">${ic('check','')}<div class="sc-num">${watched.length}</div><div class="sc-lab">اتفرجت عليها</div></div>
    <div class="stat-card">${ic('bookmark','')}<div class="sc-num">${all.filter(i=>i.status==='queue').length}</div><div class="sc-lab">في قايمة الانتظار</div></div>
    <div class="stat-card">${ic('star','fill')}<div class="sc-num">${avg?avg.toFixed(1):'—'}</div><div class="sc-lab">متوسط تقييمك</div></div>
    <div class="stat-card">${ic('clock','')}<div class="sc-num">${hours}</div><div class="sc-lab">ساعة مشاهدة تقريباً</div></div>
  </div><div class="stat-grid">`;

  // توزيع التقييمات
  if(rated.length){
    const dist={};for(let n=1;n<=10;n++)dist[n]=0;
    rated.forEach(i=>dist[i.rating]=(dist[i.rating]||0)+1);
    const maxD=Math.max(...Object.values(dist));
    html+=`<div class="stat-sec w3"><h3>توزيع تقييماتك</h3><div class="rating-bars">`;
    for(let n=1;n<=10;n++){
      const c=dist[n],h=maxD?Math.round(c/maxD*100):0;
      html+=`<div class="rb"><span class="rb-c">${c||''}</span><div class="rb-fill" style="height:${h}%;${c?'background:'+RAMP[n-1]:''}"></div><div class="rb-x">${n}</div></div>`;
    }
    html+=`</div></div>`;
  }

  // أفلام مقابل مسلسلات
  const totFT=films.length+tv.length;
  if(totFT){
    const fPct=Math.round(films.length/totFT*100);
    html+=`<div class="stat-sec w2"><h3>أفلام مقابل مسلسلات</h3>
      <div class="donut-row">
        <div class="donut" role="img" aria-label="${fPct}٪ أفلام و${100-fPct}٪ مسلسلات" style="background:conic-gradient(var(--accent) 0 ${fPct}%,var(--watched) ${fPct}% 100%)"><div><b>${totFT}</b><small>عنوان</small></div></div>
        <div class="legend">
          <div><i style="background:var(--accent)"></i><div><b>أفلام</b><small>${films.length} · ${fPct}٪</small></div></div>
          <div><i style="background:var(--watched)"></i><div><b>مسلسلات</b><small>${tv.length} · ${100-fPct}٪</small></div></div>
        </div>
      </div></div>`;
  }

  // أكتر التصنيفات (من كل القايمة)
  const gc=genreCounts(all).slice(0,6);
  if(gc.length){
    const maxG=gc[0][1], GC=['var(--accent)','var(--queue)','var(--watching)','var(--watched)','var(--dropped)','#9BE4A8'];
    html+=`<div class="stat-sec w3"><h3>التصنيفات اللي بتحبها</h3>`;
    gc.forEach(([name,c],ix)=>{
      html+=`<div class="gbar"><span class="gname" dir="auto">${esc(name)}</span><div class="gbar-track"><div class="gbar-fill" style="width:${Math.round(c/maxG*100)}%;background:${GC[ix]}"></div></div><span class="gcount">${c}</span></div>`;
    });
    html+=`</div>`;
  }

  // نشاط آخر ٦ شهور
  const now=new Date();
  const months=[];
  for(let k=5;k>=0;k--){const d=new Date(now.getFullYear(),now.getMonth()-k,1);months.push({y:d.getFullYear(),m:d.getMonth(),c:0});}
  watched.forEach(i=>{const t=i.watchedAt||i.added;if(!t)return;const d=new Date(t);const slot=months.find(x=>x.y===d.getFullYear()&&x.m===d.getMonth());if(slot)slot.c++;});
  const maxM=Math.max(1,...months.map(x=>x.c));
  const monthNames=['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  if(watched.length){
    html+=`<div class="stat-sec w2"><h3>نشاطك آخر ٦ شهور</h3><div class="month-grid">`;
    months.forEach(x=>{html+=`<div class="mo"><span class="mo-c">${x.c||''}</span><div class="mo-fill" style="height:${Math.round(x.c/maxM*100)}%"></div><div class="mo-x">${monthNames[x.m]}</div></div>`;});
    html+=`</div></div>`;
  }

  // وقت المشاهدة الفعلي (من التتبع — بيتحسب بس لما الفيديو شغال)
  const wtTotal=wt?Object.values(wt.months).reduce((a,b)=>a+b,0):0;
  if(wtTotal>=60){
    const hrs=s=>s>=3600?(s/3600).toFixed(1)+' س':Math.round(s/60)+' د';
    const thisM=wt.months[new Date().toISOString().slice(0,7)]||0;
    const top=Object.entries(wt.items).map(([id,s])=>[items.find(i=>i.id===id),s]).filter(x=>x[0]).sort((a,b)=>b[1]-a[1]).slice(0,4);
    const maxT=top.length?top[0][1]:1;
    html+=`<div class="stat-sec w3" id="wtSec"><h3>وقت المشاهدة الفعلي</h3>
      <div class="sub" style="margin-bottom:10px">الشهر ده <b>${hrs(thisM)}</b> · من أول ما بدأ التتبع <b>${hrs(wtTotal)}</b></div>`;
    top.forEach(([it,s])=>{html+=`<div class="gbar"><span class="gname" dir="auto">${esc(it.title)}</span><div class="gbar-track"><div class="gbar-fill" style="width:${Math.round(s/maxT*100)}%;background:var(--watching)"></div></div><span class="gcount">${hrs(s)}</span></div>`;});
    html+=`</div>`;
  }
  html+='</div>';

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
const KIND=it=>it.type==='tv'?'مسلسل':'فيلم';
function stampHtml(it){
  if(it.status==='watched'&&it.rating)return `<div class="stamp">${it.rating}</div>`;
  if(it.status==='watched')return `<div class="stamp q">?</div>`;
  if(it.status==='dropped')return `<div class="stamp drop">سبته</div>`;
  if(it.status==='watching'){
    const p=epPct(it);
    return p==null?'':`<div class="pprog"><i style="width:${p}%"></i></div>`;
  }
  return '';
}
const pad=n=>String(n).padStart(2,'0');
function progLabel(it){return `S${pad(it.curSeason||1)}E${pad(it.curEp||0)}`;}
// ميعاد الحلقة الجاية: "النهارده" / "بكرة" / اسم اليوم خلال أسبوع / التاريخ — null لو عدّى
function airLabel(date){
  const today=new Date().toISOString().slice(0,10);
  if(!date||date<today)return null;
  const days=Math.round((Date.parse(date)-Date.parse(today))/864e5), d=new Date(date+'T12:00:00Z');
  return days===0?'النهارده':days===1?'بكرة':days<7?d.toLocaleDateString('ar-EG',{weekday:'long'}):d.toLocaleDateString('ar-EG',{day:'numeric',month:'short'});
}
const nextEpHtml=(it,cls)=>{const n=it.nextEp, l=n&&it.status==='watching'&&airLabel(n.date);
  return l?`<span class="${cls}" title="الحلقة الجاية S${pad(n.s)}E${pad(n.e)}">${ic('clock','sm')}E${pad(n.e)} ${l}</span>`:'';};
// نسبة الموسم الحالي — null لو عدد الحلقات لسه مجاش من TMDB
function epPct(it){
  const total=it.seasonEps?it.seasonEps[it.curSeason||1]:null;
  return total>0?Math.min(100,Math.round((it.curEp||0)/total*100)):null;
}
function pcardHtml(it,ix){
  const draggable=(tab==='queue'&&queueSort==='manual');
  const nextBadge=(draggable&&ix===0)?`<span class="pill-badge next-badge">${ic('play','fill sm')}التالي</span>`:'';
  const showImdb=it.imdb&&(it.status==='queue'||it.status==='watching');
  return `
    <article class="pcard${draggable?' draggable':''}" ${draggable?'draggable="true"':''} data-act="open" data-id="${it.id}" data-itemid="${it.id}" tabindex="0" role="button" aria-label="${esc(it.title)}">
      <div class="art">
        ${it.poster?`<img src="${esc(it.poster)}" alt="" loading="lazy">`:noimgHtml(it)}
        ${nextBadge}
        ${stampHtml(it)}
        ${it.newSeason?`<button class="pill-badge bell" data-act="ackSeason" data-id="${it.id}" title="اضغط لما تشوفه">${ic('bell','sm')}موسم جديد</button>`:''}
        ${nextEpHtml(it,'pill-badge nextep')}
        ${quickHtml(it)}
      </div>
      <div class="pmeta">
        <div class="ptitle" dir="auto">${esc(it.title)}</div>
        <div class="pyear">${it.status==='watching'?`<span class="pep">${progLabel(it)}</span><span class="dotsep"></span>`:''}<span>${KIND(it)}${it.year?' · '+it.year:''}</span>${showImdb?`<span class="pimdb">★ ${it.imdb}</span>`:''}${rtHtml(it,'pimdb prt')}</div>
      </div>
    </article>`;
}
function quickHtml(it){
  if(it.status==='queue'){
    return `<div class="quick">
      <button class="btn btn-amber" data-act="player" data-id="${it.id}">${ic('play','fill sm')}شغّل</button>
      <button class="btn" data-act="watched" data-id="${it.id}">${ic('check','sm')}شفته</button>
    </div>`;
  }
  if(it.status==='watching'){
    return `<div class="quick">
      <button class="btn btn-amber" data-act="player" data-id="${it.id}">${ic('play','fill sm')}كمّل</button>
      <button class="btn" data-act="epPlus" data-id="${it.id}">${ic('plus','sm')}حلقة</button>
    </div>`;
  }
  return '';
}

/* ================= اختيار الليلة + كمّل اللي بدأته ================= */
// الـ hero بيلف على أول عناوين "هشوفهم" (بترتيبك) بانتقال هادي — وبيقف لما الماوس عليه أو فيه نافذة مفتوحة
const HERO_MAX=6, HERO_EVERY=9000, HERO_FADE=1500;
let heroIdx=0, heroSig='', heroCurId=null, heroHover=false, heroBusy=false;
const reduceMotion=matchMedia('(prefers-reduced-motion: reduce)');
function heroList(){
  return items.filter(i=>i.status==='queue').sort((a,b)=>(a.order??a.added??0)-(b.order??b.added??0)).slice(0,HERO_MAX);
}
function heroItem(){const l=heroList();return l.length?l[heroIdx%l.length]:null;}
const heroImg=it=>it.backdrop?`https://image.tmdb.org/t/p/w1280${it.backdrop}`:it.poster||null;
function heroSlideHtml(it,i,n){
  const bg=it.backdrop?`<div class="hbg"><img src="${esc(heroImg(it))}" alt=""></div>`
    :it.poster?`<div class="hbg poster"><img src="${esc(it.poster)}" alt=""></div>`:`<div class="hbg art"></div>`;
  return `${bg}<div class="hin">
    <span class="hbadge">${ic('star','fill sm')}${i===0?'اختيار الليلة · التالي في قايمتك':`اختيار الليلة · ${i+1} من ${n}`}</span>
    <div class="htitle" dir="auto">${esc(it.title)}</div>
    <div class="hmeta"><span>${KIND(it)}${it.year?' · '+it.year:''}</span>${it.imdb?`<span class="dotsep"></span><span class="imdb">IMDb ★ ${it.imdb}</span>`:''}${it.rt!=null?`<span class="dotsep"></span>${rtHtml(it,'imdb prt')}`:''}${it.genre?`<span class="dotsep"></span><span dir="auto">${esc(it.genre)}</span>`:''}</div>
    ${it.desc?`<p class="hdesc" dir="auto">${esc(it.desc)}</p>`:''}
    <div class="hact">
      <button class="btn btn-amber" data-act="player" data-id="${it.id}">${ic('play','fill')}شغّل</button>
      <button class="btn btn-glass" data-act="open" data-id="${it.id}">التفاصيل</button>
    </div></div>`;
}
const heroDotsHtml=n=>n<2?'':`<div class="hdots" role="group" aria-label="اختيارات الليلة">${Array.from({length:n},(_,i)=>
  `<button data-act="heroGo" data-ix="${i}" aria-label="اختيار ${i+1}"${i===heroIdx?' aria-current="true"':''}></button>`).join('')}</div>`;
const heroSigOf=list=>{const c=list[heroIdx];return list.map(i=>i.id).join('|')+'#'+(c?[c.id,c.title,c.backdrop,c.poster,c.imdb,c.year,c.desc,c.genre].join('|'):'');};
// انتقال لعنوان تاني: بنحمّل صورته الأول، وبعدين الشريحة الجديدة بتظهر فوق القديمة ببطء
function heroGo(ix,user){
  const list=heroList();
  if(heroBusy||list.length<2||ix===heroIdx)return;
  ix=(ix+list.length)%list.length;
  const it=list[ix];
  heroBusy=true;
  const show=()=>{
    const h=$('hero'), old=h.querySelector('.hslide.on'), s=document.createElement('div');
    s.className='hslide';s.innerHTML=heroSlideHtml(it,ix,list.length);
    h.insertBefore(s,h.querySelector('.hdots'));
    void s.offsetWidth; // عشان الـ transition يشتغل من opacity:0
    s.classList.add('on');
    if(old){old.classList.remove('on');setTimeout(()=>old.remove(),HERO_FADE+100);}
    heroIdx=ix;heroCurId=it.id;heroSig=heroSigOf(list);
    h.querySelectorAll('.hdots button').forEach((b,i)=>b.toggleAttribute('aria-current',i===ix));
    if(!modalId)setAmbient(it);
    const next=list[(ix+1)%list.length];if(next.backdrop==null)loadBackdrop(next);
    setTimeout(()=>{heroBusy=false;},HERO_FADE);
  };
  const src=heroImg(it);
  if(!src)return show();
  const img=new Image(), t=setTimeout(show,2500); // الصورة اتأخرت؟ نكمّل من غيرها
  img.onload=img.onerror=()=>{clearTimeout(t);show();};
  img.src=src;
  if(user)heroRestart();
}
let heroTimer=null;
function heroRestart(){
  clearInterval(heroTimer);
  heroTimer=setInterval(()=>{
    if(heroHover||modalId||document.hidden||reduceMotion.matches||$('homeTop').hidden)return;
    heroGo(heroIdx+1);
  },HERO_EVERY);
}
$('hero').addEventListener('mouseenter',()=>{heroHover=true;});
$('hero').addEventListener('mouseleave',()=>{heroHover=false;});
$('hero').addEventListener('focusin',()=>{heroHover=true;});
$('hero').addEventListener('focusout',()=>{heroHover=false;});
heroRestart();

function renderHome(){
  $('homeTop').hidden=!!$('search').value.trim();
  const list=heroList();
  if(heroIdx>=list.length)heroIdx=0;
  const it=list[heroIdx]||null;
  heroCurId=it?it.id:null;
  // بنعيد البناء (من غير انتقال) بس لو القايمة نفسها اتغيرت — عشان الصورة متعملش وميض مع كل render
  const sig=heroSigOf(list);
  if(sig!==heroSig&&!heroBusy){
    heroSig=sig;
    const h=$('hero');
    h.classList.toggle('empty',!it);
    if(!it){
      h.innerHTML=`<div class="hslide on"><div class="hbg art"></div><div class="hin">
        <span class="hbadge">${ic('star','fill sm')}اختيار الليلة</span>
        <div class="htitle">قايمتك لسه فاضية</div>
        <p class="hdesc">ضيف أول فيلم أو مسلسل، وكل ليلة هنختارلك حاجة تتفرج عليها</p>
        <div class="hact"><button class="btn btn-amber" data-act="addOpen">${ic('plus')}ضيف أول حاجة</button></div></div></div>`;
    }else{
      h.innerHTML=`<div class="hslide on">${heroSlideHtml(it,heroIdx,list.length)}</div>${heroDotsHtml(list.length)}`;
      list.forEach(x=>{if(x.backdrop==null)loadBackdrop(x);}); // مرة واحدة لكل عنوان (loadBackdrop بيتأكد)
    }
  }
  if(!modalId)setAmbient(it);

  // كمّل مشاهدة: اللي وقفت في نصه الأول (الأحدث)، وبعدين باقي اللي بتتفرج عليه
  const live=i=>!i._party&&(i.status==='watching'||i.status==='queue');
  const paused=items.filter(i=>live(i)&&i.resume&&i.resume.pos>=60).sort((a,b)=>(b.resume.at||0)-(a.resume.at||0));
  const watching=[...paused,...items.filter(i=>i.status==='watching'&&!paused.includes(i))].slice(0,4);
  $('cwBox').hidden=!watching.length;
  $('cwList').innerHTML=watching.map(w=>{
    const r=w.resume&&w.resume.pos>=60?w.resume:null;
    const p=r?(r.dur>0?Math.min(100,Math.round(r.pos/r.dur*100)):null):epPct(w);
    const label=r?(w.type==='tv'&&r.s&&r.e?`S${pad(r.s)}E${pad(r.e)} · `:'')+'وقفت عند '+mmss(r.pos):progLabel(w);
    return `<div class="cwrow" data-act="open" data-id="${w.id}" tabindex="0" role="button" aria-label="${esc(w.title)}">
      <div class="cwthumb">${w.poster?`<img src="${esc(w.poster)}" alt="" loading="lazy">`:noimgHtml(w,false)}</div>
      <div class="cwbody">
        <div class="cwtop"><span class="cwtitle" dir="auto">${esc(w.title)}</span><span class="cwep">${label}</span></div>
        ${nextEpHtml(w,'cwnext')}
        ${p!=null?`<div class="bar"><i style="width:${p}%"></i></div>`:''}
      </div>
      <button class="cwplay" data-act="cwPlay" data-id="${w.id}" aria-label="كمّل ${esc(w.title)}">${ic('play','fill sm')}</button>
    </div>`;
  }).join('');
  const hasFilms=items.some(i=>i.status==='queue'&&i.type==='film');
  $('mysteryBox').style.display=hasFilms?'flex':'none';
  $('side').hidden=!watching.length&&!hasFilms;
}

/* الإضاءة المحيطة: لونين من خلفية العمل المعروض (زي Ambilight) — لو الصورة مش متاحة بنرجع لألوان المزاج */
let ambSrc=null;
function setAmbient(it){
  const src=it&&it.backdrop?`https://image.tmdb.org/t/p/w300${it.backdrop}`:null;
  if(src===ambSrc)return;
  ambSrc=src;
  const st=document.documentElement.style;
  if(!src){st.removeProperty('--amb-a');st.removeProperty('--amb-b');return;}
  const img=new Image();
  img.crossOrigin='anonymous';
  img.onload=()=>{
    if(ambSrc!==src)return;
    try{
      const c=document.createElement('canvas');c.width=c.height=8;
      const x=c.getContext('2d');x.drawImage(img,0,0,8,8);
      const d=x.getImageData(0,0,8,8).data;
      const avg=(y0,y1)=>{let r=0,g=0,b=0,n=0;for(let y=y0;y<y1;y++)for(let k=0;k<8;k++){const o=(y*8+k)*4;r+=d[o];g+=d[o+1];b+=d[o+2];n++;}return vivid(r/n,g/n,b/n);};
      st.setProperty('--amb-a',avg(0,4));st.setProperty('--amb-b',avg(4,8));
    }catch(e){} // صورة من غير CORS — نفضل على ألوان المزاج
  };
  img.src=src;
}
// متوسط الصورة بيطلع باهت — نرفع التشبع ونثبّت الإضاءة عشان التوهج يبان من غير ما يزغلل
function vivid(r,g,b){
  r/=255;g/=255;b/=255;
  const mx=Math.max(r,g,b),mn=Math.min(r,g,b),l=(mx+mn)/2,dl=mx-mn;
  let h=0;
  if(dl){h=mx===r?((g-b)/dl)%6:mx===g?(b-r)/dl+2:(r-g)/dl+4;h=Math.round(h*60+360)%360;}
  const s=dl?dl/(1-Math.abs(2*l-1)):0;
  return `hsl(${h} ${Math.round(Math.max(s,.55)*100)}% ${Math.round(Math.min(Math.max(l,.55),.68)*100)}%)`;
}

function render(){
  document.querySelectorAll('.tab').forEach(b=>{b.classList.toggle('on',b.dataset.tab===tab);b.setAttribute('aria-selected',b.dataset.tab===tab);});
  $('cQueue').textContent=items.filter(i=>i.status==='queue').length||'';
  $('cWatching').textContent=items.filter(i=>i.status==='watching').length||'';
  $('cWatched').textContent=items.filter(i=>i.status==='watched').length||'';
  $('cDropped').textContent=items.filter(i=>i.status==='dropped').length||'';
  $('footCount').textContent=`${items.filter(i=>!i._party).length} عنوان في قايمتك · اتعمل للسهرات الحلوة`;
  $('sortBtn').style.display=(tab==='dropped'||tab==='watching')?'none':'';
  $('sortBtn').innerHTML=ic('sort','sm')+(tab==='watched'
    ?(sortDesc?'★ الأعلى':'★ الأقل')
    :(queueSort==='manual'?'ترتيبي':queueSort==='added'?'الأحدث':queueSort==='imdbDesc'?'IMDb ↑':'IMDb ↓'));
  $('sortBtn').title='اضغط لتغيير الترتيب';
  renderHome();

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
      (q||filterType!=='all'||filterGenre)?'مفيش نتايج بالفلاتر دي — لو مش عندك، دوس "ضيف" جنب البحث':(tab==='queue'?'ضيف أول فيلم أو مسلسل من زرار "ضيف" فوق أو من أي صفحة على IMDb':tab==='watching'?'افتح أي مسلسل في "هشوفهم" ودوس "بدأته"':tab==='dropped'?'لو بدأت حاجة وزهقت منها، افتحها ودوس "سبته"':'لما تخلص حاجة من القايمة، افتحها وقيّمها')}</div>`;
    return;
  }

  list.className='wall';
  list.innerHTML=rows.map((it,ix)=>pcardHtml(it,ix)).join('');
  if(tab==='queue'&&queueSort==='manual')enableDrag();
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
  setAmbient(heroItem());
}
$('overlay').addEventListener('click',e=>{if(e.target===$('overlay'))closeModal();});
document.addEventListener('keydown',e=>{
  if(e.key!=='Escape')return;
  if(confirmResolve){confirmDone(false);return;}
  // أول تشغيل: الشروط لازم الموافقة عليها — Escape بيقفل بس وضع الشرح من الإعدادات
  if($('welcomeOverlay').classList.contains('show')){if(wGuide)wFinish();return;}
  if($('importOverlay').classList.contains('show'))importClose();
  else if($('settingsOverlay').classList.contains('show'))closeSettings();
  else if($('partyOverlay').classList.contains('show'))partyClose();
  else if($('dlOverlay').classList.contains('show'))dlClose();
  else if($('statsOverlay').classList.contains('show'))closeStats();
  else if(playerOpen){playerOpen=false;renderModal();}
  else if(modalId)closeModal();
  else if(!$('quickAdd').hidden)qaClose();
});

async function loadBackdrop(it){
  if(!it||it.backdrop!=null||it._bdTried)return;
  it._bdTried=true;
  try{
    const tid=await resolveTmdb(it);
    const d=await tmdbFetch(`/${it.type==='tv'?'tv':'movie'}/${tid}`);
    it.backdrop=d.backdrop_path||'';
    await persist();
    if(modalId===it.id&&!playerOpen)renderModal(); // البلاير لأ — الـ iframe كان هيتحمّل من الأول
    if(heroCurId===it.id)renderHome();
  }catch(e){}
}

function renderModal(){
  const it=items.find(i=>i.id===modalId);
  if(!it){closeModal();return;}
  setAmbient(it);
  $('modal').classList.toggle('wide',playerOpen);
  $('overlay').classList.toggle('theater',playerOpen);
  if(playerOpen){$('modal').innerHTML=renderPlayer(it);partySyncMedia(it);return;}
  const bd=it.backdrop?`https://image.tmdb.org/t/p/w780${it.backdrop}`:null;
  const total=it.seasonEps?it.seasonEps[it.curSeason||1]:null;
  const remain=total!=null?Math.max(0,total-(it.curEp||0)):null;
  const ep=it.curEp||0;
  const progSec=it.status==='watching'?`
    <div class="msec">
      <div class="sh">متابعة الحلقات<span class="aside">${
        remain==null?'واقف عند '+progLabel(it)
        :remain>0?`فاضل ${remain} من ${total} في موسم ${it.curSeason||1}`:'خلصت الموسم ده ✔'}</span></div>
      <div class="prog">
        <div class="stepper">
          <button class="stepbtn" data-act="sMinus" data-id="${it.id}" aria-label="موسم أقل">−</button>
          <div class="stepval"><small>موسم</small><span class="pnum">${it.curSeason||1}</span></div>
          <button class="stepbtn" data-act="sPlus" data-id="${it.id}" aria-label="موسم أكتر">+</button>
        </div>
        <div class="stepper">
          <button class="stepbtn" data-act="eMinus" data-id="${it.id}" aria-label="حلقة أقل">−</button>
          <div class="stepval"><small>حلقة</small><span class="pnum">${ep}</span></div>
        </div>
        <button class="btn btn-ep" data-act="epPlus" data-id="${it.id}">${ic('check')}حلقة اتفرجت</button>
      </div>
      ${total>0&&total<=40?`<div class="epdots" role="img" aria-label="اتفرجت ${ep} من ${total} حلقات">${Array.from({length:total},(_,i)=>`<i class="${i<ep-1?'on':i===ep-1?'cur':''}"></i>`).join('')}</div>`:''}
      ${remain==null&&!it.tmdbId?'<div class="remain">عدد حلقات المواسم بيتجاب من TMDB لو المفتاح متسجل</div>':''}
      ${it.totalSeasons?`<div class="remain">إجمالي ${it.totalSeasons} مواسم</div>`:''}
    </div>`:'';
  const rateSec=it.status==='watched'?`
    <div class="msec">
      <div class="sh">تقييمي${it.rating?`<span class="aside"><b style="font-family:var(--display);font-size:22px;color:var(--watched)">${it.rating}</b> / 10</span>`:''}</div>
      <div class="pills">${[1,2,3,4,5,6,7,8,9,10].map(n=>
        `<button class="pill ${it.rating===n?'on':''}" data-act="rate" data-id="${it.id}" data-n="${n}" aria-label="تقييم ${n}">${n}</button>`).join('')}</div>
      <div class="noterow">
        <input type="text" id="mNote" dir="auto" value="${esc(it.note)}" placeholder="ليه عجبك / معجبكش؟ — سطر واحد بيحسّن ترشيحات الـ AI" aria-label="ملاحظتي">
        <button class="btn btn-amber" data-act="saveNote" data-id="${it.id}">حفظ</button>
      </div>
    </div>`
    :it.status==='dropped'?`
    <div class="msec">
      <div class="sh">ليه سبته؟</div>
      <div class="noterow">
        <input type="text" id="mNote" dir="auto" value="${esc(it.note)}" placeholder="بيدخل ملف الذوق كإشارة سلبية قوية للـ AI" aria-label="ليه سبته">
        <button class="btn btn-amber" data-act="saveNote" data-id="${it.id}">حفظ</button>
      </div>
    </div>`
    :(it.note?`<div class="msec"><div class="sh">ملاحظتي</div><div class="mnote-view" dir="auto">${esc(it.note)}</div></div>`:'');
  const ST={queue:'هشوفه',watching:'بتفرج',watched:'شفته',dropped:'سبته'};
  const active=it.status==='queue'||it.status==='watching';

  // الترتيب: مين/إيه ← شغّل ← المحتوى ← مواقع المشاهدة ← أدوات صغيرة
  $('modal').innerHTML=`
    <div class="bdrop">${bd?`<img src="${esc(bd)}" alt="">`:noimgHtml(it,false)}</div>
    <button class="mclose" data-act="closeModal" title="إغلاق" aria-label="إغلاق">${ic('x')}</button>
    <div class="mhead">
      <div class="mposter">${it.poster?`<img src="${esc(it.poster)}" alt="">`:noimgHtml(it)}</div>
      <div class="mtitles">
        <div class="mtitle" dir="auto">${esc(it.title)}</div>
        <div class="mchips">
          ${ST[it.status]?`<span class="mchip st st-${it.status}">${ST[it.status]}</span>`:''}
          <span class="mchip">${KIND(it)}${it.year?' · '+it.year:''}</span>
          ${it.imdb?`<span class="mchip iv">IMDb ★ ${it.imdb}</span>`:''}${rtHtml(it,'mchip iv prt')}
          ${it.genre?`<span class="mchip" dir="auto">${esc(it.genre)}</span>`:''}
        </div>
        <div class="mact">
          <button class="btn btn-amber" data-act="player" data-id="${it.id}">${ic('play','fill')}شغّل هنا</button>
          ${it.status==='queue'?`<button class="btn" data-act="watched" data-id="${it.id}">${ic('check')}شفته — قيّمه</button>`:''}
          ${it.status==='queue'&&it.type==='tv'?`<button class="btn" data-act="startWatch" data-id="${it.id}">${ic('play','fill sm')}بدأته</button>`:''}
          ${it.status==='watching'?`<button class="btn" data-act="watched" data-id="${it.id}">${ic('check')}خلصته — قيّمه</button>`:''}
        </div>
      </div>
    </div>
    <div class="mbody">
      ${it.desc?`<div class="mdesc" dir="auto">${esc(it.desc)}</div>`:''}
      ${it.newSeason?`<button class="newseason" data-act="ackSeason" data-id="${it.id}">${ic('bell')}<span>موسم جديد نزل!</span><small>اضغط لما تشوفه</small></button>`:''}
      ${progSec}
      ${rateSec}
      ${it.recWhy||it.recFrom?`<div class="msec why"><div class="sh">${ic('spark')}اترشحلك ليه</div><div class="rw">${recWhyHtml(it.recWhy,it.recFrom)}</div></div>`:''}
      ${active&&sites.some(s=>!s.dl)?`<div class="msec">
        <div class="sh">اتفرج على موقع<span class="aside">بيفتح في نافذة جديدة</span></div>
        <div class="sitegrid">${siteBtns(it,false)}</div>
      </div>`:''}
      <div class="msec">
        <div class="sh">حمّل من<span class="aside">${it.type==='tv'?`S${pad(it.curSeason||1)}E${pad((it.curEp||0)+1)} · `:''}ضيف مواقع تانية من الإعدادات ← مواقع</span></div>
        <div class="sitegrid"><button class="site" data-act="download" data-id="${it.id}"><span dir="ltr">${esc(tplHost($('dlTpl').value.trim()||DEFAULT_DL))}</span>${ic('download','sm')}</button>${siteBtns(it,true)}</div>
      </div>
      <div class="mtools">
        <button class="tool" data-act="trailer" data-id="${it.id}">${ic('film')}تريلر</button>
        ${active?`<button class="tool" data-act="drop" data-id="${it.id}">${ic('x')}سبته</button>`:''}
        ${it.status!=='queue'?`<button class="tool" data-act="toQueue" data-id="${it.id}">${ic('undo')}رجّعه للقايمة</button>`:''}
        <button class="tool danger" data-act="del" data-id="${it.id}">${ic('trash')}حذف</button>
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
async function epPlus(id,keepPlayer){
  const it=items.find(i=>i.id===id);if(!it)return;
  it.curEp=(it.curEp||0)+1;
  const total=it.seasonEps?it.seasonEps[it.curSeason||1]:null;
  if(total&&it.curEp>=total){
    if(it.totalSeasons&&(it.curSeason||1)<it.totalSeasons){
      toast(`خلصت موسم ${it.curSeason} ✔ يلا على موسم ${it.curSeason+1}`);
      it.curSeason++;it.curEp=0;
    }else{
      it.curEp=total;
      toast('خلصت المسلسل كله — دوس "خلصته" وقيّمه');
    }
  }
  // keepPlayer: التتبع التلقائي — منعيدش تحميل البلاير وهو لسه بيتفرج على التترات
  await persist();render();if(modalId&&!keepPlayer)renderModal();
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
  if(!(await uiConfirm('متأكد إنك عايز تمسحه من القايمة؟',{yes:'امسح',no:'لأ، سيبه',danger:true})))return;
  items=items.filter(i=>i.id!==id);
  if(modalId===id)closeModal();
  await persist();render();toast('اتحذف');
}

/* ================= TMDB ================= */
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
      <span class="site-name" dir="auto">${ic(s.dl?'download':'play',s.dl?'sm':'fill sm')}${esc(s.name)}${s.dl?'<span class="sub"> · تحميل</span>':''}</span>
      <span class="site-url" dir="ltr">${esc(s.url)}</span>
      ${window.__wlDesktop?`<button class="iconbtn blk" style="width:36px;height:36px;border:none" data-act="siteBlock" data-ix="${ix}" aria-pressed="${!s.noBlock}" title="${s.noBlock?'حظر الإعلانات مقفول للموقع ده — دوس تشغّله':'حظر الإعلانات شغال — دوس تقفله للموقع ده'}">${ic('shield','sm')}</button>`:''}
      <button class="iconbtn btn-danger" style="width:36px;height:36px;border:none" data-act="delSite" data-ix="${ix}" aria-label="امسح ${esc(s.name)}">${ic('x','sm')}</button>
    </div>`).join('')
    :'<div class="sub">مفيش مواقع متسجلة — ضيف واحد تحت</div>';
}
// زراير المواقع في صفحة العنوان — dl=true مواقع التحميل. ix = مكانه في sites (openWatch بيستخدمه)
const siteBtns=(it,dl)=>sites.map((s,ix)=>!!s.dl!==dl?'':`<button class="site" data-act="watch" data-id="${it.id}" data-site="${ix}"><span dir="auto">${esc(s.name)}</span>${ic(dl?'download':'ext','sm')}</button>`).join('');
const tplHost=t=>{try{return new URL(t.replace(/\{[^}]+\}/g,'x')).hostname.replace(/^www\./,'');}catch(e){return 'تحميل';}};
async function addSite(){
  const name=$('siteName').value.trim();
  let url=$('siteUrl').value.trim();
  if(!name||!url){toast('اكتب اسم الموقع ولينك البحث');return;}
  if(!/^https?:\/\//i.test(url))url='https://'+url;
  if(!url.includes('{q}')&&!url.includes('{tmdbID}')){
    // لو مفيش placeholder نفترض بحث ووردبريس القياسي
    url=url.replace(/\/+$/,'')+'/?s={q}';
  }
  sites.push($('siteKind').value==='dl'?{name,url,dl:true}:{name,url});
  await sset('watchlist:sites',JSON.stringify(sites));
  $('siteName').value='';$('siteUrl').value='';
  renderSites();render();toast('الموقع اتضاف ✔');
}
async function siteBlock(ix){
  const s=sites[ix];if(!s)return;
  if(s.noBlock)delete s.noBlock;else s.noBlock=true;
  await sset('watchlist:sites',JSON.stringify(sites));
  renderSites();toast(s.noBlock?`حظر الإعلانات اتقفل لـ ${s.name}`:`حظر الإعلانات رجع لـ ${s.name}`);
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
// آخر صفحة عنوان فتحت نافذة موقع — التنزيل اللي يطلع منها يتربط بالعنوان ده في المكتبة
const markSiteOpen=it=>{lastSiteOpen={id:it.id,s:it.type==='tv'?it.curSeason||1:null,e:it.type==='tv'?(it.curEp||0)+1:null,at:Date.now()};};
async function openWatch(id,ix){
  const it=items.find(i=>i.id===id);const s=sites[ix];
  if(!it||!s)return;
  markSiteOpen(it);
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
async function openDownload(id){
  const it=items.find(i=>i.id===id);if(!it)return;
  markSiteOpen(it);
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
// حظر الإعلانات في نوافذ المواقع (main بيقرا watchlist:adblock — '0' = مقفول لكل المواقع)
async function toggleAdblock(){
  const on=$('adblockBtn').getAttribute('aria-checked')!=='true';
  await sset('watchlist:adblock',on?'1':'0');
  $('adblockBtn').setAttribute('aria-checked',on?'true':'false');
  toast(on?'حظر الإعلانات رجع ✔':'حظر الإعلانات اتقفل — افتح الموقع تاني');
}
function shieldLabel(){
  if($('shieldBtn'))$('shieldBtn').setAttribute('aria-checked',playerShield?'true':'false');
}
async function togglePlayerShield(){
  playerShield=!playerShield;
  await sset('watchlist:playerShield',playerShield?'1':'0');
  shieldLabel();
  if(modalId&&playerOpen)renderModal();
  toast(playerShield?'الوضع الصارم اشتغل — لو سيرفر رفض يشغّل، اقفله':'رجعنا للوضع العادي');
}
function playerFs(){
  const box=document.querySelector('.playerbox');
  if(!box)return;
  const el=document.fullscreenElement||document.webkitFullscreenElement;
  if(el){(document.exitFullscreen||document.webkitExitFullscreen).call(document);return;}
  const req=box.requestFullscreen||box.webkitRequestFullscreen;
  if(req)req.call(box);
  else toast('المتصفح رافض ملء الشاشة — جرّب زرار "نافذة"');
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
  await sset(SRV_LIST_LEN_KEY,String(PLAYER_SERVERS.length));
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
  if(!pool.length){toast('محتاج أفلام في "هشوفهم" الأول');return;}
  const pick=weightedPick(pool);
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
  if(it)toast(it.title);
}
async function playerNext(id){
  // الحلقة اتحسبت تلقائي خلاص — نحمّل الجاية بس من غير ما نعدّ تاني
  if(track&&track.id===id&&track.done.size){renderModal();return;}
  await epPlus(id); // بيعمل persist + renderModal فالبلاير بيتحمّل بالحلقة الجديدة
}

/* ================= تتبع الحلقات تلقائي =================
   بلايرات vsembed/vidsrc وvidlink (حتى في السيرفر المخصص) بيبعتوا مكانهم ومدتهم — وvidsrc بيبعت الحلقة اللي شغالة فعلاً.
   عند 90% الحلقة بتتعلّم اتشافت والعدّاد يتقدم،
   ومكان الوقوف بيتحفظ. track = الحلقة اللي في البلاير دلوقتي (بيتعمل في renderPlayer) */
const mmss=s=>Math.floor(s/60)+':'+pad(Math.floor(s%60));
addEventListener('message',e=>{
  const f=document.querySelector('.playerbox iframe');
  // بس من فريم البلاير نفسه (إعلان في فريم جواه ميقدرش). مش بنقارن الدومين: السيرفرات بتعمل redirect (vidsrc-embed.ru → vidsrc.sh)
  if(!track||!playerOpen||!f||e.source!==f.contentWindow)return;
  const ev=WlProgress.parse(e.data);
  const it=ev&&items.find(i=>i.id===track.id);
  if(!it||it._party)return; // نسخة الـ Watch Party المؤقتة مبتتغيرش
  if(ev.tmdb!=null&&ev.tmdb!==it.tmdbId)return; // البلاير بيقول إنه شغال عنوان تاني
  // الحلقة: اللي البلاير بيقول عليها (لو اختارتها من جواه)، وإلا اللي البرنامج فتحها
  const tv=it.type==='tv', s=tv?(ev.s??track.s):0, ep=tv?(ev.e??track.e):0;
  addWatch(track,it.id,ev.pos,ev.paused);
  const r=WlProgress.step(track,ev,s+'x'+ep);
  if(r==='save'){saveResume(it,tv?s:null,tv?ep:null,ev.pos,ev.dur);persist();}
  else if(r==='done')autoDone(it,s,ep);
});
/* وقت المشاهدة: من أحداث البلاير (الفيديو شغال فعلاً، مش وقت البلاير مفتوح). { months:{"YYYY-MM":ثواني}, items:{id:ثواني} } */
const WT_KEY='watchlist:watchtime';
let wt=null, wtDirty=false;
function parseWt(raw){
  const o={months:{},items:{}};
  try{const j=JSON.parse(raw||'{}');
    for(const k of ['months','items'])if(j&&j[k]&&typeof j[k]==='object')
      for(const [a,b] of Object.entries(j[k]).slice(0,5000))
        if(num(b)!=null&&num(b)>=0&&(k==='months'?/^\d{4}-\d{2}$/:/^[\w-]{1,40}$/).test(a))o[k][a]=num(b);
  }catch(e){}
  return o;
}
// sess = حالة البلاير (track أو بلاير المكتبة): الفرق بين حدثين ورا بعض والفيديو شغال (أكبر من 30 ث = تقديم، مش مشاهدة)
function addWatch(sess,id,pos,paused){
  const prev=sess.wtPos;sess.wtPos=pos;
  const d=pos-prev;
  if(paused||prev==null||!wt||!(d>0&&d<=30))return;
  const m=new Date().toISOString().slice(0,7);
  wt.months[m]=(wt.months[m]||0)+d;wt.items[id]=(wt.items[id]||0)+d;wtDirty=true;
}
const flushWatch=()=>{if(wtDirty){wtDirty=false;sset(WT_KEY,JSON.stringify(wt));}};
setInterval(flushWatch,60000);
sget(WT_KEY).then(r=>{wt=parseWt(r);});
const saveResume=(it,s,e,pos,dur)=>{it.resume={...(s&&e?{s,e}:{}),pos:Math.floor(pos),dur:Math.floor(dur),at:Date.now()};};
async function autoDone(it,s,e){
  it.resume=undefined;
  if(it.type!=='tv'){
    if(it.status==='queue'||it.status==='watching'){
      it.status='watched';if(!it.watchedAt)it.watchedAt=Date.now();
      toast('اتعلّم إنك شفته ✔ قيّمه لما تخلص');
    }
    await persist();render();return;
  }
  // حلقة قدّام العدّاد = العدّاد يتنقل لبعدها (حتى لو نطّيت حلقات من جوه البلاير).
  // حلقة قديمة (بتعيدها) = العدّاد ميرجعش لورا. مسلسل خلص/اتساب منغيرش حالته
  const cs=it.curSeason||1, ce=it.curEp||0;
  if(!(s>cs||(s===cs&&e>ce))||(it.status!=='watching'&&it.status!=='queue')){await persist();return;}
  if(it.status==='queue'){it.status='watching';loadSeasonEps(it);}
  it.curSeason=s;it.curEp=e-1;
  toast(`S${pad(s)}E${pad(e)} اتعلّمت ✔`);
  await epPlus(it.id,true);
  const b=document.querySelector('.pbar [data-act="playerNext"], .pbar [data-act="startWatch"]');
  if(b)b.outerHTML=`<button class="btn btn-ep" data-act="playerNext" data-id="${it.id}">${ic('play','fill sm')}شغّل الجاية</button>`;
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
  const src=playerSrc(it);
  const mystery=mysteryMode&&mysteryId===it.id;
  const s=it.curSeason||1, e=(it.curEp||0)+1;
  const epTxt=it.type==='tv'?`<span class="ep">S${pad(s)} · E${pad(e)}</span>`:'';
  // حلقة/سيرفر جديد = تتبع جديد. نفس الحلقة (إعادة رسم عادية) = نكمّل بنفس الحالة عشان متتحسبش مرتين
  const key=[it.id,s,e,playerSrv].join('|');
  if(src&&(!track||track.key!==key))track={key,id:it.id,s,e,done:new Set(),ep:null,savedAt:null};
  const rs=it.resume;
  const resumeTxt=!mystery&&rs&&rs.pos>=60
    ?`<span class="srv" title="آخر مرة وقفت هنا — قدّم البلاير للمكان ده">${ic('clock','sm')}وقفت عند ${it.type==='tv'&&rs.s&&rs.e?`S${pad(rs.s)}E${pad(rs.e)} · `:''}${mmss(rs.pos)}</span>`:'';
  const custom=$('playerTpl').value.trim();
  const nSrv=PLAYER_SERVERS.length+((custom&&custom!==DEFAULT_PLAYER)?1:0);
  const srvName=playerSrv<PLAYER_SERVERS.length?PLAYER_SERVERS[playerSrv].name:'مخصص';
  const srvHost=(()=>{try{return new URL(currentPlayerTpl().replace(/\{[^}]+\}/g,'x')).hostname;}catch(e){return'';}})();
  const srvChips=`<button class="srv on" data-act="playerSrvCycle" data-n="${nSrv}" title="بدّل السيرفر لو مش شغال — دلوقتي: ${esc(srvHost)}">${ic('server','sm')}${srvName} — بدّل</button>`;
  const frame=!src?'':playerShield
    ?`<iframe src="${esc(src)}" sandbox="allow-scripts allow-same-origin allow-forms allow-presentation allow-orientation-lock" allow="fullscreen 'src' *; encrypted-media *; autoplay *; picture-in-picture *" allowfullscreen webkitallowfullscreen mozallowfullscreen referrerpolicy="no-referrer"></iframe>`
    :`<iframe src="${esc(src)}" allow="fullscreen 'src' *; encrypted-media *; autoplay *; picture-in-picture *" allowfullscreen webkitallowfullscreen mozallowfullscreen></iframe>`;
  return `
    <div class="pbar">
      <button class="mclose plain" data-act="playerClose" title="رجوع للتفاصيل" aria-label="رجوع للتفاصيل">${ic('x','sm')}</button>
      <div class="pt">${mystery?`<b>فيلم غامض</b>`:`<b dir="auto">${esc(it.title)}</b>${epTxt}`}</div>
      ${mystery?'':srvChips}
      ${resumeTxt}
      ${mystery?'':`<span id="partyBadge">${partyBadgeHtml()}</span>`}
      <button class="srv" data-act="playerFs" title="ملء الشاشة">${ic('expand','sm')}ملء الشاشة</button>
      ${mystery
        ?`<button class="srv" data-act="mysteryReveal" data-id="${it.id}" title="اكشف الفيلم">${ic('eye','sm')}اكشف الاسم</button>`
        :`<button class="srv" data-act="playerPop" data-id="${it.id}" title="افتح البلاير في نافذة مستقلة">${ic('window','sm')}نافذة</button>`}
      ${!mystery&&it.type==='tv'&&it.status==='watching'
        ?`<button class="btn btn-ep" data-act="playerNext" data-id="${it.id}">${ic('check','sm')}خلصتها — شغّل الجاية</button>`
        :!mystery&&it.type==='tv'&&it.status==='queue'
        ?`<button class="btn btn-sm" data-act="startWatch" data-id="${it.id}">${ic('play','fill sm')}فعّل متابعة الحلقات</button>`:''}
    </div>
    <div class="playerbox">
      ${frame||`<div class="mystery-reveal"><div class="giftbig">${ic('gift')}</div><div class="mr-t">بجهّزلك المفاجأة…</div><div class="mr-s">استنى ثانية، الفيلم جاي</div></div>`}
      ${mystery?`<div class="wl-veil" id="wlVeil">
        <div class="giftbig">${ic('gift')}</div>
        <div class="wl-veil-t" id="wlVeilT">فيلمك الغامض جاهز</div>
        <div class="wl-veil-s">لما تضغط، الفيلم هيبدأ لوحده ونعدّيك على شاشة البداية — فمتشوفش بوستر ولا اسم، على طول مشهد من الفيلم</div>
        <button class="btn btn-amber" data-act="mysteryStart">${ic('play','fill')}ابدأ المفاجأة</button>
      </div>`:''}
    </div>`;
}

/* ================= المفاتيح ================= */

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
    if(!(await uiConfirm('الاسترجاع هيستبدل كل البيانات الحالية بالنسخة دي — متأكد؟',{yes:'استرجع',danger:true})))return;
    await chrome.storage.local.set(data);
    toast('اترجعت ✔');
    setTimeout(()=>location.reload(),600);
  }catch(err){toast('الملف ده مش نسخة احتياطية صالحة');}
});

/* ================= استيراد ترشيحات الـ AI ================= */
$('tasteBtn').onclick=()=>{
  impCands=[];
  $('impText').value='';$('impList').innerHTML='';$('impStatus').textContent='';
  $('impAddBtn').style.display='none';$('impFoot').hidden=true;
  $('pasteBox').open=!window.__wlAi; // الاكستنشن مفيهوش AI مدمج — اللصق هو الطريق الوحيد
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
    $('impList').innerHTML='';$('impAddBtn').style.display='none';$('impFoot').hidden=true;
    return;
  }
  const have=new Set(items.map(i=>i.title.toLowerCase()));
  $('impList').innerHTML=impCands.map((c,ix)=>{
    const dup=have.has(c.title.toLowerCase());
    return `<label class="impRow" style="${dup?'opacity:.45':''}">
      <input type="checkbox" data-ix="${ix}" ${dup?'':'checked'} ${dup?'disabled':''}>
      <span class="impP">…</span>
      <span dir="auto">${esc(c.title)}${c.why?`<span class="iwhy" dir="auto">${esc(c.why)}</span>`:''}</span>
      ${c.year?`<span class="iy">${c.year}</span>`:''}
      ${c.why||c.from.length?`<button type="button" class="impWhyBtn" data-act="impWhy" data-ix="${ix}" title="اترشح ليه؟" aria-label="اترشح ليه؟" aria-expanded="false">${ic('bulb')}</button>`:''}
      ${dup?'<span class="iy">موجود في قايمتك</span>':`<select class="impSeen" aria-label="هشوفه ولا شفته؟" title="شفته قبل كده؟ قيّمه ويتضاف لـ'شفتها' — كده الترشيحات الجاية بتبقى أدق">
        <option value="">+ هشوفه</option>
        ${[10,9,8,7,6,5,4,3,2,1].map(n=>`<option value="${n}">شفته ★${n}</option>`).join('')}
        <option value="w">شفته (من غير تقييم)</option>
      </select>`}
    </label><div class="impWhyBox" data-ix="${ix}" hidden></div>
    <div class="impNoteRow" data-ix="${ix}" hidden><input type="text" class="impNote" dir="auto" maxlength="300" placeholder="رأيك فيه في سطر (اختياري) — عجبك ليه / معجبكش ليه؟ ده بيحسّن الترشيحات الجاية"></div>`;
  }).join('');
  $('impStatus').textContent=`لقيتلك ${impCands.length} عنوان`;
  $('impAddBtn').style.display='';$('impFoot').hidden=false;
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
  if(!(await sget('watchlist:tmdbkey'))){boxes.forEach(b=>b.innerHTML=ic('film'));return;}
  await Promise.all(cands.map(async(c,ix)=>{
    try{c.tm=await tmdbBest(c);}catch(e){c.tm=undefined;} // undefined = الإضافة تجرب تاني
    const box=boxes[ix];
    if(gen!==impGen||!box)return; // اتعمل استخراج جديد في النص
    box.textContent='';
    const p=c.tm&&c.tm.poster_path;
    if(typeof p==='string'&&/^\/[\w.-]+$/.test(p)){
      const img=document.createElement('img');img.alt='';img.src='https://image.tmdb.org/t/p/w92'+p;box.appendChild(img);
    }else box.innerHTML=ic('film');
    const row=box.closest('.impRow'), cb=row.querySelector('input');
    if(c.tm&&!cb.disabled&&items.some(i=>i.tmdbId===c.tm.id&&(i.type==='tv')===(c.tm.media_type==='tv'))){
      cb.checked=false;cb.disabled=true;row.style.opacity='.45';
      row.querySelector('.impSeen')?.remove();
      document.querySelector(`.impNoteRow[data-ix="${ix}"]`).hidden=true;
      row.insertAdjacentHTML('beforeend','<span class="iy">موجود في قايمتك</span>');
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
        item.rt=rtOf(om);item.rtChecked=true;
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
  NOT_CONFIGURED:'ظبّط الـ AI من الإعدادات الأول (الإعدادات ← الذكاء الاصطناعي)',
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
  $('aiSec').style.display='';$('aiRunBtn').style.display='';$('navAi').style.display='';
  const c=await window.__wlAi.get();
  $('aiKind').value=c.kind;$('aiUrl').value=c.url;$('aiKey').value='';
  aiFillModels(c.model?[c.model]:[],c.model); // القايمة الكاملة بتتجاب لما تفتح القسم
  $('aiKey').placeholder=c.hasKey?'محفوظ ●●●● — سيبه فاضي عشان يفضل زي ما هو':'sk-...';
  $('aiNote').textContent=c.url?`متظبط: ${c.model} — ${c.hasKey?'بمفتاح':'من غير مفتاح'}`:'لسه مش متظبط — اختار خدمة من فوق';
  $('aiRunNote').textContent=c.url?c.model:'ظبّط الـ AI من الإعدادات الأول';
  aiMarkProv();
}
// الكارت المتعلّم = الخدمة اللي رابطها مطابق للمكتوب
function aiMarkProv(){
  const u=$('aiUrl').value.trim();
  document.querySelectorAll('#aiProviders .prov').forEach(b=>{const p=AI_PRESETS[b.dataset.v];b.classList.toggle('on',!!p&&p.url===u);});
}
async function aiFetchModels(){
  if(!window.__wlAi||!$('aiUrl').value.trim())return;
  const n=++aiModelsReq, keep=$('aiModel').value;
  $('aiNote').textContent='بجيب الموديلات من السيرفر…';
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
  $('aiNote').textContent='ببعت رسالة تجربة للموديل…';
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
  if(!(await uiConfirm('تمسح إعدادات الـ AI والمفتاح؟',{yes:'امسح',danger:true})))return;
  await window.__wlAi.set({url:''});
  await aiLoad();toast('إعدادات الـ AI اتمسحت');
}
function aiPresetPick(v){
  const p=AI_PRESETS[v];
  if(!p)return;
  $('aiKind').value=p.kind;$('aiUrl').value=p.url;aiWant=p.want||[];
  aiFillModels([],'');aiMarkProv();
  if(p.local||$('aiKey').value.trim())aiFetchModels();
  else{$('aiNote').textContent='حط المفتاح وهجيب الموديلات لوحدي';$('aiKey').focus();}
}
// أي تغيير في الرابط/النوع/المفتاح = هات القايمة تاني. وأول ما تفتح القسم بنجيبها لو فيه إعدادات محفوظة
['aiUrl','aiKind','aiKey'].forEach(id=>$(id).addEventListener('change',aiFetchModels));
$('aiUrl').addEventListener('input',aiMarkProv);
$('aiSec').addEventListener('toggle',e=>{if(e.target.open&&aiModelList.length<=1)aiFetchModels();});
async function aiRun(){
  const btn=$('aiRunBtn');
  btn.disabled=true;
  $('impStatus').textContent='الـ AI بيفكر في ذوقك… (الموديلات المحلية ممكن تاخد دقيقة)';
  try{
    const r=await window.__wlAi.run(tasteProfile());
    if(!r.ok){$('impStatus').textContent='⚠ '+aiErrText(r);return;}
    $('impText').value=r.text;
    importParse(); // نفس مسار اللصق اليدوي: استخراج العناوين وانت تختار
  }catch(e){$('impStatus').textContent='⚠ حصل خطأ غير متوقع';}
  finally{btn.disabled=false;}
}

/* ================= تصدير/استيراد الإعدادات ================= */
const SETTINGS_KEYS=['watchlist:omdbkey','watchlist:tmdbkey','watchlist:sites','watchlist:playerTpl','watchlist:playerSrv','watchlist:srvListLen','watchlist:playerShield','watchlist:statsOpen','watchlist:theme','watchlist:dlTpl','watchlist:subLang'];
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
  document.querySelector(`.impWhyBtn[data-ix="${ix}"]`)?.setAttribute('aria-expanded',String(!box.hidden));
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
  toast('الأوضة شغّالة: '+it.title);
}
function partyBadgeHtml(){
  if(!partyApi||!party.enabled)return'';
  if(party.status==='connected')
    return `<button class="srv live" data-act="partyOpen" title="Watch Party"><span class="mono" dir="ltr">${esc(fmtCode(party.code))}</span> · ${Number(party.peers)||0}</button>`;
  if(party.status==='connecting'||party.status==='reconnecting')
    return `<button class="srv" data-act="partyOpen" title="Watch Party">${ic('refresh','sm')}بيتصل…</button>`;
  return `<button class="srv" data-act="partyOpen" title="Watch Party">${ic('users','sm')}<span dir="ltr">Watch Party</span></button>`;
}
function renderParty(){
  const badge=$('partyBadge');if(badge)badge.innerHTML=partyBadgeHtml(); // من غير renderModal — الـ iframe ميتعملوش reload
  // نقطة نعناعي على زرار الهيدر طول ما انت جوه أوضة
  $('partyBtn').innerHTML=ic('users')+(party.status==='connected'?'<span class="ndot" style="background:var(--watching)"></span>':'');
  const body=$('partyBody');if(!body)return;
  const err=party.error?`<div class="perr">${ic('alert','sm')}${esc(PARTY_ERRORS[party.error]||'حصلت مشكلة — جرب تاني')}</div>`:'';
  if(!party.enabled){body.innerHTML=`<div class="sub">${PARTY_ERRORS.no_server}</div>`;return;}
  if(party.status==='idle'){
    body.innerHTML=`
      <button class="btn btn-amber" data-act="partyCreate" style="height:52px">${ic('plus')}اعمل أوضة جديدة</button>
      <div class="or">أو ادخل أوضة صاحبك</div>
      <div style="display:flex;gap:8px">
        <input type="text" id="partyCode" class="codein" dir="ltr" maxlength="9" placeholder="ABCD-EFGH" aria-label="كود الأوضة" style="flex:1">
        <button class="btn" data-act="partyJoin" style="height:50px">ادخل</button>
      </div>`+err;
    return;
  }
  if(party.status!=='connected'){
    const re=party.status==='reconnecting';
    body.innerHTML=err+`<div style="text-align:center">
        <div class="spin"></div>
        <b style="display:block;font-family:var(--display);font-size:20px">${re?'النت فصل…':'بيتصل بالأوضة…'}</b>
        <div class="sub">${re?'بحاول أرجع للأوضة لوحدي':'ثانية واحدة'}</div>
      </div>
      <button class="btn btn-ghost" data-act="partyLeave">إلغاء</button>`;
    return;
  }
  const peers=Math.min(Number(party.peers)||0,8);
  const dots=['var(--accent)','var(--watched)','var(--queue)','var(--watching)','var(--dropped)'];
  const m=party.media;
  body.innerHTML=err+`
    <div class="peers"><span class="livedot"></span><span style="color:var(--watching);font-weight:600;flex:1">الأوضة شغّالة</span>
      <span class="who">${Array.from({length:Math.min(peers,5)},(_,i)=>`<b style="background:${dots[i]}"></b>`).join('')}</span><span>${peers} في الأوضة</span></div>
    <div class="ticket">
      <small>كود الأوضة — ابعته لصاحبك</small>
      <div class="code">${esc(fmtCode(party.code))}</div>
      <div class="fieldrow" style="justify-content:center">
        <button class="btn btn-sm" data-act="partyCopy">${ic('copy','sm')}انسخ الكود</button>
        ${party.webUrl?`<button class="btn btn-sm btn-amber" data-act="partyCopyLink" title="لصحابك اللي معندهمش البرنامج — بيفتح من الموبايل أو أي متصفح">${ic('copy','sm')}انسخ لينك للويب</button>`:''}
      </div>
    </div>
    <div class="nowon">${m?`${ic('film')}<div><small>بتتفرجوا على</small><b dir="auto">${esc(m.title)}</b>${m.type==='tv'?` <span dir="ltr" style="color:var(--watching);font-weight:600">S${pad(Number(m.season)||1)}E${pad(Number(m.episode)||1)}</span>`:''}</div>`
      :'<span class="sub">مستنيين حد يفتح فيلم أو حلقة من البلاير</span>'}</div>
    ${m&&!(playerOpen&&itemMatchesMedia(items.find(i=>i.id===modalId),m))?`<button class="btn btn-ep" data-act="partyWatch">${ic('play','fill sm')}افتح البلاير</button>`:''}
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
// لينك صفحة الويب جاي من main (نفس سيرفر الأوضة) — مبيتبنيش من حاجة في الواجهة
async function partyCopyLink(){
  if(!party.webUrl)return;
  try{await navigator.clipboard.writeText(party.webUrl);toast('اللينك اتنسخ ✔ صاحبك يفتحه من الموبايل أو أي متصفح');}
  catch(e){toast('معرفتش أنسخ — اللينك: '+party.webUrl);}
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

/* ================= التنزيلات والمكتبة (الديسكتوب بس) =================
   التنزيل والحفظ والتشغيل في main (downloads.js) — هنا العرض والأزرار بس */
const dlApi=window.__wlDesktop&&window.__wlDesktop.dl;
let dl={dir:'',items:[],library:[]}, dlPlaying=null;
// ربط ملفات المكتبة بالعناوين: { اسم الملف: {id, s, e} } — بيتسجل لما التنزيل يبدأ من نافذة موقع اتفتحت من صفحة عنوان،
// وإلا بنخمّن من اسم الملف (WlProgress.fileGuess)
let libMap={}, lastSiteOpen=null;
const LIB_KEY='watchlist:lib', SITE_LINK_MS=30*60*1000;
function parseLib(raw){
  const out={};
  try{const o=JSON.parse(raw||'{}');
    if(o&&typeof o==='object')for(const [k,v] of Object.entries(o).slice(0,2000))
      if(k.length<=200&&v&&/^[\w-]{1,40}$/.test(str(v.id)))out[k]={id:v.id,s:num(v.s),e:num(v.e)};
  }catch(e){}
  return out;
}
function libInfo(f){
  const l=libMap[f.name]||WlProgress.fileGuess(f.name,items.filter(i=>!i._party));
  const it=l&&items.find(i=>i.id===l.id);
  return it?{it,s:it.type==='tv'?l.s:null,e:it.type==='tv'?l.e:null}:null;
}
// ملف محلي للحلقة اللي هتتشاف (اللي وقفت فيها، وإلا الجاية) أو للفيلم
function libFileFor(it){
  const r=it.resume, s=r&&r.s?r.s:(it.curSeason||1), e=r&&r.e?r.e:(it.curEp||0)+1;
  return dl.library.find(f=>{const l=libInfo(f);return l&&l.it===it&&(it.type!=='tv'||(l.s===s&&l.e===e));});
}
const fmtSize=b=>!(b>0)?'':b>=1e9?(b/1e9).toFixed(2)+' GB':(b/1e6).toFixed(1)+' MB';
// الوقت الفاضل: ثواني → "45 ث" / "12 د" / "1 س 20 د"
const fmtEta=s=>s<60?Math.ceil(s)+' ث':s<3600?Math.ceil(s/60)+' د':Math.floor(s/3600)+' س '+Math.round(s%3600/60)+' د';
const DL_STATE={confirm:'مستني موافقتك',progressing:'بيتنزّل',paused:'متوقف',interrupted:'اتقطع',completed:'خلص',cancelled:'اتلغى'};
function dlActs(d){
  const b=(a,t)=>`<button class="srv" data-act="dlAct" data-id="${Number(d.id)}" data-a="${a}">${t}</button>`;
  if(d.state==='confirm')return b('start','نزّل')+b('cancel','إلغاء');
  if(d.state==='progressing')return b('pause','إيقاف مؤقت')+b('cancel','إلغاء');
  if(d.state==='paused')return b('resume','كمّل')+b('cancel','إلغاء');
  if(d.state==='interrupted')return b('resume','كمّل');
  if(d.state==='completed')return b('show','الفولدر');
  return '';
}
function renderDl(){
  const box=$('dlBody');
  if(dlPlaying){
    box.innerHTML=`<div style="display:flex;gap:8px;align-items:center"><button class="srv" data-act="dlBack">${ic('x','sm')}رجوع</button><b dir="auto" class="dlname">${esc(dlPlaying.name)}</b></div>
      <video id="dlVideo" controls autoplay crossorigin="anonymous" src="${esc(dlPlaying.url)}">${(dlPlaying.subs||[]).map((s,i)=>`<track kind="subtitles" src="${esc(s.url)}" label="${esc(s.label)}"${/^[a-z]{2,3}$/i.test(s.label)?` srclang="${esc(s.label)}"`:''}${i===0?' default':''}>`).join('')}</video>`;
    return;
  }
  const rows=dl.items.map(d=>{
    const pct=d.total>0?Math.min(100,Math.round(d.received/d.total*100)):null, live=d.state!=='completed'&&d.state!=='cancelled';
    return `<div class="dlrow"><div class="grow"><div class="dlname" dir="auto">${esc(d.name)}</div>
      <div class="sub">${DL_STATE[d.state]||''}${live&&pct!=null?' · '+pct+'%':''} ${fmtSize(d.total)}${d.speed>0?' · '+fmtSize(d.speed)+'/ث'+(d.total>d.received?' · فاضل '+fmtEta((d.total-d.received)/d.speed):''):''}</div>
      ${live&&pct!=null?`<progress max="100" value="${pct}"></progress>`:''}</div>${dlActs(d)}</div>`;
  }).join('');
  const lib=dl.library.map((f,ix)=>{const l=libInfo(f), it=l&&l.it;
    return `<div class="dlrow">${it?`<div class="cwthumb">${it.poster?`<img src="${esc(it.poster)}" alt="">`:noimgHtml(it,false)}</div>`:''}
    <div class="grow"><div class="dlname" dir="auto">${it?esc(it.title)+(l.s&&l.e?` · S${pad(l.s)}E${pad(l.e)}`:''):esc(f.name)}</div>
    <div class="sub">${it?`<span dir="ltr">${esc(f.name)}</span> · `:''}${fmtSize(f.size)}</div></div>
    <button class="btn btn-amber btn-sm" data-act="dlPlay" data-ix="${ix}">${ic('play','fill sm')}شغّل</button><button class="srv" data-act="dlReveal" data-ix="${ix}">الفولدر</button></div>`;}).join('');
  box.innerHTML=`<div class="sub" style="display:flex;gap:8px;align-items:center"><span>بيتحفظوا في</span>
      <span dir="ltr" class="dlname" style="flex:1;min-width:0;font-weight:400">${esc(dl.dir)}</span><button class="srv" data-act="dlPickDir">غيّر</button></div>
    ${rows?`<h3>التنزيلات</h3>${rows}`:''}
    <h3>المكتبة</h3>${lib||'<div class="sub">لسه فاضية — أي فيلم تنزّله من مواقعك هيظهر هنا</div>'}`;
}
async function dlRefresh(){try{dl=await dlApi.state();}catch(e){}if(!dlPlaying)renderDl();}
function dlOpen(){dlPlaying=null;renderDl();$('dlOverlay').classList.add('show');dlRefresh();}
// تشغيل ملف من المكتبة: بلايرنا إحنا، فالتتبع بيقرا الـ <video> مباشرة، و"كمّل من مكان ما وقفت" بيقدّم الفيديو فعلاً
function dlPlayFile(f){
  dlPlaying=f;
  $('dlOverlay').classList.add('show');
  renderDl();
  const v=$('dlVideo'), l=libInfo(f), it=l&&l.it;
  if(!v||!it||it._party)return;
  const tv=it.type==='tv', s=l.s, e=l.e;
  if(tv&&!(s&&e))return; // حلقة مش معروفة — منعلّمش حلقة غلط
  const sess={done:new Set(),ep:null,savedAt:null}, key=tv?s+'x'+e:'0x0';
  v.addEventListener('loadedmetadata',()=>{
    const r=it.resume;
    if(r&&r.pos>=60&&r.pos<v.duration*WlProgress.DONE_AT&&(!tv||(r.s===s&&r.e===e))){v.currentTime=r.pos;toast('كمّلت من '+mmss(r.pos));}
  },{once:true});
  const onTime=()=>{
    if(dlPlaying!==f||!Number.isFinite(v.duration))return;
    addWatch(sess,it.id,v.currentTime,v.paused);
    const ev={pos:v.currentTime,dur:v.duration,paused:v.paused}, r=WlProgress.step(sess,ev,key);
    if(r==='save'){saveResume(it,s,e,ev.pos,ev.dur);persist();render();}
    else if(r==='done')autoDone(it,tv?s:0,tv?e:0);
  };
  v.addEventListener('timeupdate',onTime);v.addEventListener('pause',onTime);
}
// زرار ▶ في "كمّل مشاهدة": الملف المحلي لو موجود (بيكمّل من نفس الثانية)، وإلا البلاير
function cwPlay(id){
  const it=items.find(i=>i.id===id);if(!it)return;
  const f=dlApi&&libFileFor(it);
  if(f)dlPlayFile(f);else openPlayer(id);
}
function dlClose(){dlPlaying=null;$('dlOverlay').classList.remove('show');renderDl();} // renderDl بيشيل الفيديو فبيقف
if(dlApi){
  $('dlBtn').style.display='';
  // المكتبة من أول ما البرنامج يفتح — زرار "كمّل" محتاج يعرف لو فيه ملف محلي
  sget(LIB_KEY).then(r=>{libMap=parseLib(r);return dlRefresh();}).then(()=>render(),()=>{});
  $('dlOverlay').addEventListener('click',e=>{if(e.target===$('dlOverlay'))dlClose();});
  dlApi.onList(l=>{dl.items=Array.isArray(l)?l:[];if(!dlPlaying)renderDl();});
  // قبل ما أي تنزيل يبدأ: اسم الملف وحجمه وجاي منين — عشان محدش ينزّل برنامج ضار وهو فاكره فيلم
  dlApi.onAsk(async a=>{
    if(!a||!Number.isInteger(a.id))return;
    const size=Number(a.size)||0, ext=String(a.ext||''), video=/^\.(mp4|m4v|webm|mkv|mov|avi|ts)$/.test(ext);
    const warn=[];
    if(!size)warn.push('⚠ الموقع مقالش حجمه');
    else if(video&&size<50e6)warn.push('⚠ حجمه صغير أوي على فيلم أو حلقة — غالباً مش اللي إنت عايزه');
    if(/^\.(zip|rar|7z)$/.test(ext))warn.push('⚠ ملف مضغوط — لو لقيت جواه .exe أو أي برنامج متفتحوش');
    const ok=await uiConfirm(`تنزّل الملف ده؟\n${String(a.name||'')}\n${size?fmtSize(size):'حجم مش معروف'} · من ${String(a.host||'موقع مش معروف')}${warn.length?'\n\n'+warn.join('\n'):''}`,{yes:'نزّل',no:'لأ، الغيه'});
    // التنزيل جاي من نافذة موقع اتفتحت من صفحة عنوان؟ يتربط بيه (وبالحلقة اللي كانت عليها)
    if(ok&&lastSiteOpen&&Date.now()-lastSiteOpen.at<SITE_LINK_MS&&items.some(i=>i.id===lastSiteOpen.id)){
      libMap[String(a.name)]={id:lastSiteOpen.id,s:lastSiteOpen.s,e:lastSiteOpen.e};
      sset(LIB_KEY,JSON.stringify(libMap));
    }
    dlApi.act(a.id,ok?'start':'cancel');
  });
  dlApi.onEvent(ev=>{
    const n=String(ev&&ev.name||'');
    if(ev.kind==='started')toast('بدأ تنزيل '+n+' — تابعه من تنزيلاتي');
    else if(ev.kind==='blocked')toast('اتمنع تنزيل '+n+' — نوع الملف ده ممكن يكون برنامج ضار');
    else if(ev.kind==='done'){toast('خلص تنزيل '+n+' ✔');dlRefresh();}
    else if(ev.kind==='open')dlOpen();
  });
}

/* ================= التحديثات (الديسكتوب بس) =================
   الفحص والتنزيل والتحقق في main (update-controller.js) — هنا بنعرض الحالة بس */
const updApi=window.__wlDesktop&&window.__wlDesktop.update;
let upd=null;
function renderUpd(){
  if(!upd)return;
  if($('verTxt'))$('verTxt').textContent='v'+upd.current;
  $('updCur').textContent='النسخة اللي عندك: '+upd.current;
  const T={
    dev:'التحديث التلقائي بيشتغل في النسخة المتثبّتة بس',
    idle:'البرنامج بيدوّر على تحديثات لوحده كل 6 ساعات — أو دوّر دلوقتي',
    checking:'بدوّر على تحديث...',
    'up-to-date':'✔ إنت على آخر نسخة',
    downloading:`فيه نسخة جديدة ${upd.version||''} — بتنزل ${upd.percent}%`,
    downloaded:`✔ نسخة ${upd.version||''} نزلت وجاهزة — ثبّتها وأعد تشغيل البرنامج`,
    error:upd.error==='OFFLINE'?'معرفتش أوصل لسيرفر التحديثات — اتأكد من النت وجرّب تاني':'حصلت مشكلة وأنا بدوّر — جرّب تاني بعد شوية',
  };
  $('updStatus').textContent=T[upd.status]||'';
  $('updBar').hidden=upd.status!=='downloading';
  $('updFill').style.width=upd.percent+'%';
  $('updCheckBtn').disabled=upd.status==='checking'||upd.status==='downloading'||upd.status==='dev';
  $('updCheckBtn').hidden=upd.status==='downloaded';
  $('updInstallBtn').hidden=upd.status!=='downloaded';
}
async function updCheck(){upd=await updApi.check();renderUpd();}
async function updInstall(){
  const inParty=typeof party!=='undefined'&&party.status==='connected';
  if(!(await uiConfirm('البرنامج هيقفل ويفتح تاني بالنسخة الجديدة'+(inParty?' — وهتخرج من الـ Watch Party':'')+'. نكمّل؟',{yes:'ثبّت دلوقتي',no:'بعدين'})))return;
  if(!(await updApi.install()))toast('التحديث لسه مش جاهز');
}
if(updApi){
  $('updSec').style.display='';
  updApi.get().then(st=>{upd=st;renderUpd();}).catch(()=>{});
  updApi.onState(st=>{upd=st;renderUpd();});
}

/* ================= لينكات برا البرنامج ================= */
// الديسكتوب: main بيفتحها في المتصفح (قايمة ثابتة هناك). الاكستنشن: تاب جديد
function openLink(url){
  if(window.__wlDesktop&&window.__wlDesktop.openExternal)window.__wlDesktop.openExternal(url).catch(()=>{});
  else window.open(url,'_blank','noopener');
}

/* ================= فحص المفاتيح ================= */
// بيتأكد إن المفتاح شغال قبل ما يتحفظ: 'ok' | 'bad' | 'limit' | 'offline' | 'empty'
async function checkTmdbKey(tok){
  tok=str(tok).trim();
  if(!tok)return 'empty';
  if(!/^[\x21-\x7e]{16,1000}$/.test(tok))return 'bad';
  const v4=tok.startsWith('eyJ');
  try{
    const res=await fetch('https://api.themoviedb.org/3/configuration'+(v4?'':'?api_key='+encodeURIComponent(tok)),
      {headers:v4?{Authorization:'Bearer '+tok}:{},signal:AbortSignal.timeout(15000)});
    if(res.status===401)return 'bad';
    return res.ok?'ok':'offline';
  }catch(e){return 'offline';}
}
async function checkOmdbKey(k){
  k=str(k).trim();
  if(!k)return 'empty';
  if(!/^[A-Za-z0-9]{6,20}$/.test(k))return 'bad';
  try{
    // The Shawshank Redemption — موجود دايماً
    const m=await(await fetch(`https://www.omdbapi.com/?apikey=${encodeURIComponent(k)}&i=tt0111161`,{signal:AbortSignal.timeout(15000)})).json();
    if(m.Response==='True')return 'ok';
    return /limit/i.test(str(m.Error))?'limit':'bad';
  }catch(e){return 'offline';}
}
const KEY_MSG={
  ok:['ok','✓ المفتاح شغال واتحفظ'],
  limit:['warn','المفتاح صحيح واتحفظ، بس خلص حده النهارده — هيرجع يشتغل بكرة'],
  bad:['bad','✗ المفتاح ده مش شغال — اتأكد إنك نسخته كامل (ولو OMDb: دوست على لينك التفعيل في الإيميل؟)'],
  offline:['warn','معرفتش أتأكد دلوقتي — اتأكد من النت وجرّب تاني'],
  empty:['bad','حط المفتاح الأول'],
  checking:['','بتأكد...'],
};
function keyStat(el,st){const [cls,msg]=KEY_MSG[st];el.className='kstat'+(cls?' '+cls:'');el.textContent=msg;}
// بيحفظ المفتاح بس لو شغال (أو صحيح وخلص حده) — مفتاح غلط مبيتحفظش
async function saveCheckedKey(kind,val,statEl){
  keyStat(statEl,'checking');
  const st=kind==='tmdb'?await checkTmdbKey(val):await checkOmdbKey(val);
  if(st==='ok'||st==='limit')await sset(kind==='tmdb'?'watchlist:tmdbkey':'watchlist:omdbkey',str(val).trim());
  keyStat(statEl,st);
  return st;
}

/* ================= أول تشغيل: الشروط + شرح المفاتيح =================
   الشروط بتظهر لأي حد موافقش على النسخة دي. خطوات المفاتيح بس لأول تشغيل من غير مفتاح TMDB.
   وزرار "إزاي أجيبه؟" في الإعدادات بيفتح خطوة واحدة (wGuide) */
const TERMS_VERSION='1';
let wsteps=[], wix=0, wGuide=false;
function wShow(){
  const step=wsteps[wix];
  document.querySelectorAll('#welcomeOverlay .wstep').forEach(s=>{s.hidden=s.dataset.step!==step;});
  $('wDots').innerHTML=wsteps.length>1?wsteps.map((s,i)=>`<b class="${i===wix?'on':i<wix?'done':''}"></b>`).join(''):'';
  $('wClose').hidden=!wGuide;
  $('welcomeOverlay').classList.toggle('guide',wGuide);
  $('wTmdbLater').hidden=wGuide;$('wOmdbSkip').hidden=wGuide;
  $('welcomeOverlay').classList.add('show');
}
function wNext(){if(wix<wsteps.length-1){wix++;wShow();}else wFinish();}
async function wFinish(){
  $('welcomeOverlay').classList.remove('show');
  if(!wGuide)await sset('watchlist:onboarded','1');
  wGuide=false;
  if(typeof refreshKeyStatus==='function')refreshKeyStatus();
}
async function startOnboarding(){
  const steps=[];
  if((await sget('watchlist:termsAccepted'))!==TERMS_VERSION)steps.push('terms');
  if(!(await sget('watchlist:onboarded'))&&!(await sget('watchlist:tmdbkey')))steps.push('choice','tmdb','omdb','done');
  if(!steps.length)return;
  wsteps=steps;wix=0;wGuide=false;
  $('wAgree').checked=false;$('wAgreeBtn').disabled=true;
  wShow();
}
function showGuide(step){wsteps=[step];wix=0;wGuide=true;wShow();}
$('wAgree').addEventListener('change',e=>{$('wAgreeBtn').disabled=!e.target.checked;});
async function wAgree(){
  if(!$('wAgree').checked)return;
  await sset('watchlist:termsAccepted',TERMS_VERSION);
  wNext();
}
async function wKeySave(kind){
  const input=$(kind==='tmdb'?'wTmdb':'wOmdb'), stat=$(kind==='tmdb'?'wTmdbStat':'wOmdbStat');
  const st=await saveCheckedKey(kind,input.value,stat);
  if(st==='ok'||st==='limit')setTimeout(wNext,900);
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
    case 'del': del(id); break;
    case 'watch': openWatch(id, parseInt(el.dataset.site)); break;
    case 'trailer': openTrailer(id); break;
    case 'ackSeason': ackSeason(id); break;
    case 'addSite': addSite(); break;
    case 'delSite': delSite(parseInt(el.dataset.ix)); break;
    case 'siteBlock': siteBlock(parseInt(el.dataset.ix)); break;
    case 'dlOpen': dlOpen(); break;
    case 'dlClose': dlClose(); break;
    case 'dlAct': dlApi.act(parseInt(el.dataset.id),el.dataset.a); break;
    case 'dlPlay': {const f=dl.library[parseInt(el.dataset.ix)];if(f)dlPlayFile(f);} break;
    case 'cwPlay': cwPlay(id); break;
    case 'dlBack': dlPlaying=null;dlRefresh(); break;
    case 'dlReveal': {const f=dl.library[parseInt(el.dataset.ix)];if(f)dlApi.reveal(f.name);} break;
    case 'dlPickDir': dlApi.pickDir().then(()=>dlRefresh()); break;
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
    case 'subLang': saveSubLang(el.dataset.v); break;
    case 'download': openDownload(id); break;
    case 'playerSrv': setPlayerSrv(parseInt(el.dataset.ix)); break;
    case 'playerSrvCycle': playerSrvCycle(parseInt(el.dataset.n)); break;
    case 'playerShield': togglePlayerShield(); break;
    case 'adblockToggle': toggleAdblock(); break;
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
    case 'setImport': $('setFile').click(); break;
    case 'partyOpen': partyOpen(); break;
    case 'partyClose': partyClose(); break;
    case 'partyCreate': partyCreate(); break;
    case 'partyJoin': partyJoin(); break;
    case 'partyLeave': partyLeave(); break;
    case 'partyCopy': partyCopy(); break;
    case 'partyCopyLink': partyCopyLink(); break;
    case 'updCheck': updCheck(); break;
    case 'keySave': keySave(el.dataset.k); break;
    case 'keyShared': keyShared(); break;
    case 'keyGuide': showGuide(el.dataset.k); break;
    case 'showTerms': showGuide('terms'); break;
    case 'defSrv': defSrv(parseInt(el.dataset.ix)); break;
    case 'wAgree': wAgree(); break;
    case 'wHaveFile': $('setFile').click(); break; // الاستيراد بيعمل reload، وأول ما يفتح هيلاقي المفتاح فمش هيعرض الخطوات
    case 'wFresh': case 'wNext': wNext(); break;
    case 'wOpen': openLink(el.dataset.url); break;
    case 'wTmdbSave': wKeySave('tmdb'); break;
    case 'wOmdbSave': wKeySave('omdb'); break;
    case 'wDone': case 'wClose': wFinish(); break;
    case 'updInstall': updInstall(); break;
    case 'partyWatch': partyClose(); partyOpenMedia(party.media); break;
    case 'aiSave': aiSave(); break;
    case 'aiClear': aiClear(); break;
    case 'aiRun': aiRun(); break;
    case 'aiModels': aiFetchModels(); break;
    case 'aiTest': aiTest(); break;
    case 'impWhy': e.preventDefault(); impWhyToggle(parseInt(el.dataset.ix)); break;
    case 'addOpen': addOpen(); break;
    case 'qaClose': qaClose(); break;
    case 'qaAdd': qaAdd(el.dataset.key,el.dataset.s); break;
    case 'qaUndo': qaUndo(el.dataset.key); break;
    // window.open (مش لينك عادي) عشان الديسكتوب بيسمح بس بالنوافذ اللي الواجهة فتحتها
    case 'openGh': e.preventDefault(); if(window.__wlDesktop)window.__wlDesktop.openExternal('https://github.com/Gasser-hafez'); else window.open('https://github.com/Gasser-hafez','_blank'); break;
    case 'heroGo': heroGo(parseInt(el.dataset.ix),true); break;
    case 'setNav': setNav(el.dataset.v); break;
    case 'aiPreset': aiPresetPick(el.dataset.v); break;
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
  const box=img.closest('.pcard .art, .row .thumb, .mposter, .cwthumb');
  if(box){
    const card=img.closest('[data-itemid],[data-id]');
    img.remove();
    if(!box.querySelector('.noimg')){
      const id=card?(card.dataset.itemid||card.dataset.id):modalId; // البوستر في التفاصيل مالوش كارت
      const it=items.find(i=>i.id===id);
      box.insertAdjacentHTML('afterbegin',noimgHtml(it||{title:''},!box.classList.contains('cwthumb')));
    }
  }else{
    img.remove();
  }
},true);

load().then(()=>{
  if(location.search.includes('settings=1'))openSettings();
});
