// With the account sign-in registered, the sidebar footer is the account menu ("More" while signed out) and
// Settings is its first menu item, as in the official desktop app. Native smoke scripts that used to click a
// bare Settings button call this browser-side fallback: it clicks Settings when the menu is open, otherwise it
// opens the menu and reports { clicked: false } so the caller's wait loop retries.
export const SETTINGS_ENTRY_LABELS = ['Settings', '设置', 'More', '更多', 'Account menu', '账号菜单']

export const settingsMenuFallbackExpression = `(() => {
  const visible = item => { const rect = item.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 && !item.closest('[inert],[aria-hidden="true"]') }
  const entry = [...document.querySelectorAll('[role="menuitem"]')].find(item =>
    visible(item) && /^(Settings|设置)/.test((item.textContent || '').trim()))
  if (entry) { entry.click(); return { clicked: true, viaAccountMenu: true } }
  const trigger = [...document.querySelectorAll('button[aria-haspopup="menu"]')].find(item =>
    visible(item) && item.hasAttribute('data-signed-out') && item.getAttribute('aria-expanded') !== 'true')
  trigger?.click()
  return { clicked: false, openedAccountMenu: Boolean(trigger) }
})()`
