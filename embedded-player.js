// A top-level, sandboxed page drawn inside the desktop window. No app preload or IPC bridge.
function playerUrl(value) {
  if (typeof value !== 'string' || value.length > 4096) return null;
  try {
    const u = new URL(value);
    return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password ? u.href : null;
  } catch { return null; }
}

function playerBounds(rect, size) {
  if (!rect || !['x', 'y', 'width', 'height'].every(k => Number.isFinite(rect[k]))) return null;
  const x = Math.max(0, Math.min(size[0], Math.round(rect.x)));
  const y = Math.max(0, Math.min(size[1], Math.round(rect.y)));
  const right = Math.max(x, Math.min(size[0], Math.round(rect.x + rect.width)));
  const bottom = Math.max(y, Math.min(size[1], Math.round(rect.y + rect.height)));
  return { x, y, width: right - x, height: bottom - y };
}

function initEmbeddedPlayer({ ipcMain, WebContentsView, getWindow, fromApp }) {
  let view = null, loaded = null, owner = null;
  let fullscreen = false, wasFullscreen = false, layoutBounds = null, layoutRadius = 0;
  let appliedBounds = '', appliedRadius = null, appliedVisible = false;
  function resize() {
    if (!view || !owner || owner.isDestroyed()) return;
    const [width, height] = owner.getContentSize();
    const bounds = fullscreen ? { x: 0, y: 0, width, height } : layoutBounds;
    const key = JSON.stringify(bounds);
    if (key !== appliedBounds) { appliedBounds = key; view.setBounds(bounds); }
    // WebContentsView is composited above HTML: CSS overflow/border-radius cannot clip it.
    const radius = fullscreen ? 0 : layoutRadius;
    if (radius !== appliedRadius) { appliedRadius = radius; view.setBorderRadius(radius); }
  }
  function leaveFullscreen() {
    if (!fullscreen) return;
    fullscreen = false;
    if (owner && !owner.isDestroyed() && owner.isFullScreen() !== wasFullscreen) owner.setFullScreen(wasFullscreen);
    resize();
  }
  function close() {
    if (!view) return;
    leaveFullscreen();
    owner?.removeListener('resize', resize);
    const old = view; view = null; loaded = null;
    appliedBounds = ''; appliedRadius = null; appliedVisible = false;
    if (owner && !owner.isDestroyed()) owner.contentView.removeChildView(old);
    owner = null;
    if (!old.webContents.isDestroyed()) old.webContents.close();
  }
  ipcMain.on('wl:embedded:layout', (e, state) => {
    if (!fromApp(e)) return;
    const win = getWindow();
    if (!win || win.isDestroyed()) return close();
    if (!state) return close();
    const url = playerUrl(state.url);
    const zoom = win.webContents.getZoomFactor();
    const rect = state.bounds && Object.fromEntries(['x', 'y', 'width', 'height'].map(k => [k, state.bounds[k] * zoom]));
    const bounds = playerBounds(rect, win.getContentSize());
    if (!url || !bounds) return close();
    layoutBounds = bounds;
    layoutRadius = Number.isFinite(state.radius)
      ? Math.round(Math.max(0, Math.min(state.radius * zoom, bounds.width / 2, bounds.height / 2))) : 0;
    if (!view) {
      owner = win;
      view = new WebContentsView({ webPreferences: {
        nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true,
      } });
      view.setVisible(false);
      const wc = view.webContents;
      win.on('resize', resize);
      wc.on('enter-html-full-screen', () => {
        if (fullscreen) return;
        wasFullscreen = win.isFullScreen();
        fullscreen = true;
        if (!win.isFullScreen()) win.setFullScreen(true);
        resize();
      });
      wc.on('leave-html-full-screen', leaveFullscreen);
      wc.setWindowOpenHandler(() => ({ action: 'deny' }));
      for (const event of ['will-navigate', 'will-redirect']) {
        wc.on(event, (event, target) => { if (!playerUrl(target)) event.preventDefault(); });
      }
      wc.on('did-fail-load', (_event, code, _description, _url, mainFrame) => {
        if (mainFrame && code !== -3 && !win.isDestroyed()) win.webContents.send('wl:embedded:error');
      });
      win.contentView.addChildView(view);
    }
    resize();
    const visible = state.visible === true && bounds.width > 0 && bounds.height > 0;
    if (visible !== appliedVisible) { appliedVisible = visible; view.setVisible(visible); }
    if (loaded !== url) {
      loaded = url;
      view.webContents.loadURL(url).catch(() => {});
    }
  });
  return { close };
}

module.exports = { initEmbeddedPlayer, playerUrl, playerBounds };
