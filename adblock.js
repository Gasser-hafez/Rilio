// حظر الإعلانات على مستوى الشبكة — لنوافذ مواقع المشاهدة/التحميل بس.
// الواجهة وiframe البلاير مش داخلين: المشغلات بترفض أي تدخل (اتجرّب مع الـ sandbox)
// القوايم: EasyList وأخواتها جاهزة من Ghostery، متخزنة في userData وبتتجدد كل أسبوع
const fs = require('fs');
const { FiltersEngine, Request } = require('@ghostery/adblocker');

const REFRESH_MS = 7 * 86400000;

async function loadEngine(cachePath, devFilters) {
  if (devFilters) return FiltersEngine.parse(devFilters); // التست بس (مش في النسخة المتثبتة)
  try { if (Date.now() - fs.statSync(cachePath).mtimeMs > REFRESH_MS) fs.rmSync(cachePath); } catch (e) {}
  return FiltersEngine.fromPrebuiltAdsOnly(fetch, {
    path: cachePath, read: p => fs.promises.readFile(p), write: (p, buf) => fs.promises.writeFile(p, buf),
  });
}

// isSiteWindow(wc): نافذة موقع اتفتحت من البرنامج؟  isAllowed(url): المستخدم قفل الحماية للموقع ده؟
function initAdblock({ session, cachePath, devFilters, isSiteWindow, isAllowed }) {
  let engine = null;
  // من غير نت أول مرة = مفيش حظر لحد التشغيل الجاي (المواقع بتفضل شغالة عادي)
  loadEngine(cachePath, devFilters).then(e => { engine = e; }, () => {});
  session.webRequest.onBeforeRequest((d, cb) => {
    const wc = d.webContents;
    // الصفحة نفسها اللي المستخدم فاتحها متتمنعش أبداً — بس اللي جواها
    if (!engine || d.resourceType === 'mainFrame' || !wc || wc.isDestroyed() || !isSiteWindow(wc)) return cb({});
    const top = wc.getURL();
    if (isAllowed(top)) return cb({});
    const { match } = engine.match(Request.fromRawDetails({ url: d.url, sourceUrl: d.referrer || top, type: d.resourceType }));
    cb(match ? { cancel: true } : {});
  });
}

module.exports = { initAdblock };
