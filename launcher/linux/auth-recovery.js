(() => {
  const AUTH_REQUIRED_TEXT = 'dsh web authentication required; reopen the URL printed by dsh web.';
  const TEST_FLAG = '__DSH_PORTABLE_TEST_AUTH_RECOVERY__';
  const PENDING_KEY = 'dsh-portable-auth-recovery-requested';
  const TEST_READY_TYPE = 'dsh-portable/auth-recovery-ready';
  const RECONNECT_TYPE = 'dsh-portable/reconnect-workspace';
  const TEST_MARKER_TIMEOUT_MS = 30000;

  let recoveryUi = null;
  let testClickScheduled = false;
  let readyReported = false;

  const bilingual = (chinese, english) => `${chinese} / ${english}`;

  function setPending(value) {
    try {
      if (value) sessionStorage.setItem(PENDING_KEY, '1');
      else sessionStorage.removeItem(PENDING_KEY);
    } catch (_) {
      // Session storage is only a test handoff hint; the user flow does not depend on it.
    }
  }

  function isPending() {
    try {
      return sessionStorage.getItem(PENDING_KEY) === '1';
    } catch (_) {
      return false;
    }
  }

  function showError(message) {
    if (!recoveryUi) return;
    recoveryUi.error.textContent = message || bilingual('工作台重新连接失败，请重试。', 'Workspace reconnect failed. Please try again.');
    recoveryUi.error.hidden = false;
    recoveryUi.status.textContent = '';
    recoveryUi.button.disabled = false;
    recoveryUi.button.textContent = bilingual('重新连接工作台', 'Reconnect workspace');
  }

  function postNative(message) {
    const invoke = globalThis.__TAURI__?.core?.invoke;
    if (typeof invoke !== 'function') return Promise.reject(new Error('TAURI bridge unavailable'));
    try {
      return Promise.resolve(invoke('portable_host_message', { message }));
    } catch (error) {
      return Promise.reject(error);
    }
  }

  function showRecoveryScreen() {
    if (recoveryUi || !document.body || document.body.textContent.trim() !== AUTH_REQUIRED_TEXT) {
      return;
    }

    const darkTheme = document.body.hasAttribute('data-ds-dark-theme')
      || globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
    const style = document.createElement('style');
    style.textContent = `
      :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: Canvas; color: CanvasText; }
      body[data-dsh-auth-dark] { color-scheme: dark; background: #151517; color: #f5f5f5; }
      main { width: min(560px, calc(100vw - 48px)); padding: 32px; border: 1px solid color-mix(in srgb, CanvasText 20%, transparent); border-radius: 16px; box-sizing: border-box; }
      h1 { margin: 0 0 16px; font-size: 1.4rem; }
      p { white-space: pre-line; line-height: 1.6; }
      button { margin-top: 12px; padding: 10px 16px; border: 0; border-radius: 8px; background: #2463eb; color: white; font: inherit; cursor: pointer; }
      button:disabled { cursor: wait; opacity: .65; }
      [role="status"], [role="alert"] { margin-bottom: 0; }
    `;
    const main = document.createElement('main');
    const heading = document.createElement('h1');
    heading.textContent = bilingual('工作台需要重新连接', 'Workspace reconnect required');
    const description = document.createElement('p');
    description.textContent = bilingual(
      '本地工作台认证链接已失效或缺失。请重新连接后继续。',
      'The local workspace authentication link is missing or stale. Reconnect to continue.',
    );
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = bilingual('重新连接工作台', 'Reconnect workspace');
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    const error = document.createElement('p');
    error.setAttribute('role', 'alert');
    error.hidden = true;
    main.append(heading, description, button, status, error);
    document.body.replaceChildren(style, main);
    document.body.toggleAttribute('data-dsh-auth-dark', darkTheme);

    recoveryUi = { button, status, error };
    globalThis.__DSH_PORTABLE_AUTH_RECOVERY__ = Object.freeze({ showError });
    button.addEventListener('click', () => {
      button.disabled = true;
      button.textContent = bilingual('正在重新连接…', 'Reconnecting…');
      status.textContent = bilingual('正在获取新的工作台地址…', 'Requesting a fresh workspace address…');
      error.hidden = true;
      error.textContent = '';
      if (globalThis[TEST_FLAG]) setPending(true);
      postNative({ schemaVersion: 1, type: RECONNECT_TYPE }).catch(() => {
        if (globalThis[TEST_FLAG]) setPending(false);
        showError(bilingual('无法连接到本地主机，请重试。', 'The local host is unavailable. Please try again.'));
      });
    });

    if (globalThis[TEST_FLAG] && !testClickScheduled) {
      testClickScheduled = true;
      queueMicrotask(() => button.click());
    }
  }

  function workspaceIsReady() {
    const root = document.querySelector('#root');
    if (!root || root.querySelector('[data-dsh-boot]')) return false;
    const text = String(root.innerText || root.textContent || '').replace(/\s+/g, ' ').trim();
    if (text.length === 0) return false;
    const visibleControls = [...root.querySelectorAll('button, textarea, input, [contenteditable="true"], [role="button"]')]
      .filter((element) => {
        if (element.disabled) return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
    return visibleControls.length >= 2;
  }

  function reportWorkspaceReady() {
    if (!globalThis[TEST_FLAG] || readyReported || !isPending()) return;
    const deadline = Date.now() + TEST_MARKER_TIMEOUT_MS;
    let settledFrames = 0;
    const sample = () => {
      if (workspaceIsReady()) settledFrames += 1;
      else settledFrames = 0;
      if (settledFrames >= 3) {
        readyReported = true;
        setPending(false);
        postNative({ schemaVersion: 1, type: TEST_READY_TYPE }).catch(() => {});
        return;
      }
      if (Date.now() < deadline) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }

  document.addEventListener('DOMContentLoaded', () => {
    showRecoveryScreen();
    reportWorkspaceReady();
  }, { once: true });
})();
