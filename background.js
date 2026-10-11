// فتح صفحة القايمة عند الضغط على أيقونة الإكستنشن
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('app.html') });
});

// عداد "هشوفهم" على الأيقونة
async function updateBadge() {
  try {
    const d = await chrome.storage.local.get('watchlist:data');
    let n = 0;
    try { n = JSON.parse(d['watchlist:data'] || '[]').filter(i => i.status === 'queue').length; } catch (e) {}
    chrome.action.setBadgeText({ text: n ? String(n) : '' });
    chrome.action.setBadgeBackgroundColor({ color: '#e8a33d' });
    if (chrome.action.setBadgeTextColor) chrome.action.setBadgeTextColor({ color: '#161006' });
  } catch (e) {}
}
chrome.runtime.onInstalled.addListener(updateBadge);
chrome.runtime.onStartup.addListener(updateBadge);
chrome.storage.onChanged.addListener((ch, area) => {
  if (area === 'local' && ch['watchlist:data']) updateBadge();
});
updateBadge();
