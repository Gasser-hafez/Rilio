// التحديث التلقائي من GitHub Releases (electron-updater)
// بينزل في الخلفية، وبعدين بيعرض إشعار + زرار في الـ tray لإعادة التشغيل.
// electron-updater بيتأكد من sha512 للملف من latest.yml وبيرفض الرجوع لنسخة أقدم.
const { app, Notification } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('fs');
const path = require('path');

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 10 * 1000;
const LOG_MAX_BYTES = 512 * 1024;

const logFile = () => path.join(app.getPath('userData'), 'updater.log');
function log(level, msg) {
  const line = `${new Date().toISOString()} [${level}] ${msg}\n`;
  try {
    const f = logFile();
    if (fs.existsSync(f) && fs.statSync(f).size > LOG_MAX_BYTES) fs.renameSync(f, f + '.old');
    fs.appendFileSync(f, line);
  } catch (e) { console.error(line, e); }
}

// onReady(version): بيتنادى لما التحديث يخلص تحميل — main.js بيحدّث قايمة الـ tray
function initUpdater({ onReady }) {
  // النسخة اللي شغالة من npm start ملهاش app-update.yml — مفيش تحديث
  if (!app.isPackaged) return { install: () => {} };

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true; // "خروج" من الـ tray بيثبّت التحديث
  autoUpdater.allowDowngrade = false;
  autoUpdater.allowPrerelease = false;
  // الأخطاء بتتسجل مرة واحدة من event 'error' تحت — من غير headers الـ HTTP (فيها كوكيز وكلام ملوش لازمة)
  autoUpdater.logger = { info: m => log('info', m), warn: m => log('warn', m), error: () => {}, debug: () => {} };

  const install = () => autoUpdater.quitAndInstall(false, true);

  autoUpdater.on('update-available', i => log('info', `update available: ${i.version}`));
  autoUpdater.on('update-downloaded', i => {
    log('info', `update downloaded: ${i.version}`);
    onReady(i.version);
    if (Notification.isSupported()) {
      const n = new Notification({ title: 'قائمة المشاهدة', body: `نسخة ${i.version} جاهزة — اضغط هنا لإعادة التشغيل والتحديث` });
      n.on('click', install);
      n.show();
    }
  });
  // من غير نت أو GitHub واقع: حاجة عادية، بنسجلها ونحاول تاني في الدورة الجاية
  autoUpdater.on('error', e => log('error', String((e && e.message) || e).split('\n')[0]));

  const check = () => autoUpdater.checkForUpdates().catch(() => {}); // اتسجل خلاص في 'error'
  setTimeout(check, FIRST_CHECK_DELAY_MS);
  setInterval(check, CHECK_EVERY_MS);

  return { install };
}

module.exports = { initUpdater };
