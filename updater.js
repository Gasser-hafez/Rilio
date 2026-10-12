// التحديث التلقائي من GitHub Releases (electron-updater)
// بينزل في الخلفية، وبعدين بيعرض إشعار + زرار في الـ tray لإعادة التشغيل.
// electron-updater بيتأكد من sha512 للملف من latest.yml وبيرفض الرجوع لنسخة أقدم.
const { app, Notification } = require('electron');
const { autoUpdater } = require('electron-updater');
const { createUpdateController } = require('./update-controller');
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

// onChange(state): كل تغيير في حالة التحديث (main.js بيحدّث الـ tray والواجهة)
// بيرجّع { check, install, getState } — check للزرار اليدوي، والفحص الدوري شغال لوحده
function initUpdater({ onChange }) {
  const controller = createUpdateController({ updater: autoUpdater, isPackaged: app.isPackaged, currentVersion: app.getVersion() });
  controller.onChange(onChange);
  // النسخة اللي شغالة من npm start ملهاش app-update.yml — الحالة 'dev' ومفيش طلبات
  if (!app.isPackaged) return controller;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true; // "خروج" من الـ tray بيثبّت التحديث
  autoUpdater.allowDowngrade = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.disableWebInstaller = true; // بنستخدم installer كامل بس — مفيش web installer
  // الأخطاء بتتسجل مرة واحدة من event 'error' تحت — من غير headers الـ HTTP (فيها كوكيز وكلام ملوش لازمة)
  autoUpdater.logger = { info: m => log('info', m), warn: m => log('warn', m), error: () => {}, debug: () => {} };

  autoUpdater.on('update-available', i => log('info', `update available: ${i.version}`));
  autoUpdater.on('update-downloaded', i => {
    log('info', `update downloaded: ${i.version}`);
    if (Notification.isSupported()) {
      const n = new Notification({ title: 'rilio', body: `نسخة ${i.version} جاهزة — اضغط هنا لإعادة التشغيل والتحديث` });
      n.on('click', controller.install);
      n.show();
    }
  });
  // من غير نت أو GitHub واقع: حاجة عادية، بنسجلها والـ controller بيعرضها لو الفحص يدوي
  autoUpdater.on('error', e => log('error', String((e && e.message) || e).split('\n')[0]));

  setTimeout(controller.check, FIRST_CHECK_DELAY_MS);
  setInterval(controller.check, CHECK_EVERY_MS);
  return controller;
}

module.exports = { initUpdater };
