// قاتل الـ popups الخفي — بيشتغل في عالم الصفحة نفسها (MAIN world) قبل أي سكريبت
// بيستبدل window.open بنسخة بترجع "نافذة وهمية" فسكريبتات الإعلانات تفتكر إنها نجحت
(() => {
  const makeFakeWin = () => {
    const fake = {
      closed: false,
      opener: null,
      focus() {}, blur() {}, print() {},
      close() { fake.closed = true; },
      postMessage() {},
      resizeTo() {}, moveTo() {},
      location: { href: '', assign() {}, replace() {}, reload() {}, toString: () => '' },
      document: { write() {}, writeln() {}, close() {}, open() { return fake.document; } },
    };
    return fake;
  };
  try {
    Object.defineProperty(window, 'open', {
      value: function () { return makeFakeWin(); },
      writable: false,
      configurable: false,
    });
  } catch (e) {
    window.open = function () { return makeFakeWin(); };
  }
})();
