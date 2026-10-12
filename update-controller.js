// حالة التحديث: idle → checking → up-to-date | downloading(%) → downloaded | error
// مفيش require لـ electron هنا — بياخد الـ updater من برا، فبيتختبر بـ updater وهمي (test/update-controller.test.mjs)

const OFFLINE_RE = /ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_NETWORK|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ERR_CONNECTION|net::/i;
const errorCode = e => (OFFLINE_RE.test(String((e && e.message) || e)) ? 'OFFLINE' : 'FAILED');

function createUpdateController({ updater, isPackaged, currentVersion }) {
  let state = { status: isPackaged ? 'idle' : 'dev', current: currentVersion, version: null, percent: 0, error: null };
  const listeners = new Set();
  const set = patch => {
    state = { ...state, ...patch };
    for (const fn of listeners) fn(state);
  };
  let checking = null;

  if (isPackaged) {
    updater.on('checking-for-update', () => { if (state.status !== 'downloading' && state.status !== 'downloaded') set({ status: 'checking', error: null }); });
    updater.on('update-not-available', () => set({ status: 'up-to-date', error: null }));
    updater.on('update-available', i => set({ status: 'downloading', version: (i && i.version) || null, percent: 0, error: null }));
    updater.on('download-progress', p => {
      const pct = Math.max(0, Math.min(100, Math.round(Number(p && p.percent) || 0)));
      set({ status: 'downloading', percent: pct });
    });
    updater.on('update-downloaded', i => set({ status: 'downloaded', version: (i && i.version) || state.version, percent: 100, error: null }));
    // غلط بعد ما التحديث نزل خلاص (مثلاً فحص دوري تاني والنت قاطع) ميلغيش "جاهز للتثبيت"
    updater.on('error', e => { if (state.status !== 'downloaded') set({ status: 'error', error: errorCode(e) }); });
  }

  // فحص يدوي أو دوري — لو فيه فحص شغال بنرجّع نفس الـ promise بدل ما نعمل طلب تاني
  function check() {
    if (!isPackaged || state.status === 'downloading' || state.status === 'downloaded') return Promise.resolve(state);
    if (!checking) {
      checking = Promise.resolve()
        .then(() => updater.checkForUpdates())
        .catch(e => { if (state.status === 'checking' || state.status === 'idle') set({ status: 'error', error: errorCode(e) }); })
        .then(() => {
          checking = null;
          // checkForUpdates رجع من غير ما يقول متاح/مش متاح (مثلاً null) — منسيبش الواجهة على "بيدوّر"
          if (state.status === 'checking') set({ status: 'error', error: 'FAILED' });
          return state;
        });
    }
    return checking;
  }

  // التثبيت بس لو التحديث نزل وخلص التحقق منه (electron-updater بيتأكد من الـ sha512 قبل update-downloaded)
  function install() {
    if (state.status !== 'downloaded') return false;
    updater.quitAndInstall(false, true);
    return true;
  }

  return { check, install, getState: () => state, onChange: fn => { listeners.add(fn); return () => listeners.delete(fn); } };
}

module.exports = { createUpdateController, errorCode };
