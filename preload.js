const { contextBridge, ipcRenderer } = require('electron');

if (process.isMainFrame && location.origin === 'app://local') {
  // واجهة البرنامج نفسها: shim لـ chrome.storage.local عشان app.js يشتغل من غير تعديل
  const listeners = [];
  ipcRenderer.on('wl:changed', (e, changes) => listeners.forEach(fn => fn(changes, 'local')));
  contextBridge.exposeInMainWorld('__wlStorage', {
    local: {
      get: keys => ipcRenderer.invoke('wl:get', keys),
      set: obj => ipcRenderer.invoke('wl:set', obj),
    },
    onChanged: { addListener: fn => listeners.push(fn) },
  });
  contextBridge.exposeInMainWorld('__wlAllowOpen', () => ipcRenderer.sendSync('wl:allowOpen'));
  contextBridge.executeInMainWorld({
    func: () => {
      // window.chrome موجود أصلاً في Chromium فمينفعش نعمله expose — بنضيف storage جواه
      (window.chrome ||= {}).storage = window.__wlStorage;
      // أي window.open من الواجهة نفسها بياخد تصريح؛ أي نافذة من غير تصريح (لينكات إعلانات في iframe البلاير) بتتمنع
      const open = window.open;
      window.open = function (...a) { window.__wlAllowOpen(); return open.apply(window, a); };
    },
  });
} else {
  // أي فريم أو صفحة خارجية (البلاير، مواقع المشاهدة): نفس سكريبتات الاكستنشن
  const s = ipcRenderer.sendSync('wl:scripts');
  // popupblock لازم يشتغل في عالم الصفحة نفسها قبل أي سكريبت
  contextBridge.executeInMainWorld({ func: new Function(s.popupblock) });
  new Function(s.mysteryhide)();
}
