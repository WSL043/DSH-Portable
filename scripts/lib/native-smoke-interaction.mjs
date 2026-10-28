// Shared browser expressions for native smoke and its DOM behavior tests.
import { settingsMenuFallbackExpression } from './settings-entry.mjs'

export const clickButton = names => `(() => {
  const names = ${JSON.stringify(names)}
  const button = [...document.querySelectorAll('button,[role="button"]')].find(item => {
    const rect = item.getBoundingClientRect()
    const style = getComputedStyle(item)
    if (rect.width <= 0 || rect.height <= 0 || item.disabled
      || item.getAttribute('aria-disabled') === 'true'
      || item.closest('[inert],[aria-hidden="true"]')
      || style.visibility === 'hidden' || style.visibility === 'collapse') return false
    const label = item.getAttribute('aria-label') || item.getAttribute('title') || item.textContent || ''
    return names.includes(label.trim())
  })
  if (!button && names.includes('设置')) {
    const viaMenu = ${settingsMenuFallbackExpression}
    if (viaMenu.clicked) return viaMenu
  }
  if (!button) return {
    clicked: false,
    controls: [...document.querySelectorAll('button,[role="button"],a')].slice(0, 80).map(item => ({
      tag: item.tagName,
      role: item.getAttribute('role') || '',
      ariaLabel: item.getAttribute('aria-label') || '',
      title: item.getAttribute('title') || '',
      text: (item.textContent || '').trim().slice(0, 80),
    })),
  }
  button.click()
  return { clicked: true }
})()`

// Alpha.2 exposes official read-only inventory cards, not the retired Shell form.
export const builtInPluginCard = function makeBuiltInPluginCardExpression(entryId, expanded) { return `(() => {
  const entryId = ${JSON.stringify(entryId)}
  const desired = ${JSON.stringify(expanded) ?? 'undefined'}
  const visible = item => {
    if (!item) return false
    const rect = item.getBoundingClientRect()
    const style = getComputedStyle(item)
    return rect.width > 0 && rect.height > 0 && !item.closest('[inert],[aria-hidden="true"]')
      && style.visibility !== 'hidden' && style.visibility !== 'collapse'
  }
  const cards = [...document.querySelectorAll('[data-plugin-entry]')]
    .filter(item => item.getAttribute('data-plugin-entry') === entryId && visible(item))
  if (cards.length !== 1) return { ready: false, clicked: false, cardCount: cards.length }
  const card = cards[0]
  const button = card.querySelector('button[aria-controls][aria-expanded]')
  if (!visible(button) || button.disabled || button.getAttribute('aria-disabled') === 'true') {
    return { ready: false, clicked: false, cardCount: 1 }
  }
  let clicked = false
  if (typeof desired === 'boolean' && (button.getAttribute('aria-expanded') === 'true') !== desired) {
    button.scrollIntoView({ block: 'center', inline: 'nearest' })
    button.click()
    clicked = true
  }
  const controlsId = button.getAttribute('aria-controls') || ''
  const details = controlsId ? document.getElementById(controlsId) : null
  return {
    ready: true, clicked, cardCount: 1, controlsId,
    entryId: card.getAttribute('data-plugin-entry'), moduleName: card.getAttribute('data-plugin-module'),
    expanded: button.getAttribute('aria-expanded') === 'true', detailVisible: visible(details),
    detailsPresent: Boolean(details), detailOwned: Boolean(details && card.contains(details)),
    identity: (details?.querySelector('[data-loader-entry]')?.textContent || '').trim(),
    facts: details ? [...details.querySelectorAll('dl > div')].map(item => ({
      label: (item.querySelector('dt')?.textContent || '').trim(), value: (item.querySelector('dd')?.textContent || '').trim(),
    })) : [],
  }
})()` }

export const officialPowerShellDetailsReady = value => Boolean(
  value?.ready && value.cardCount === 1 && value.entryId === 'tool-pwsh'
  && value.moduleName === '@deepseek-ai/dsh-tool-pwsh' && value.controlsId
  && value.expanded && value.detailVisible && value.detailOwned && value.detailsPresent && value.identity === 'tool-pwsh'
  && value.facts?.some(item => ['Module', '完整名称'].includes(item.label) && item.value === value.moduleName)
  && value.facts?.some(item => ['From', '来自'].includes(item.label) && item.value.length > 0)
  && value.facts?.some(item => ['Configuration', '配置状态'].includes(item.label) && ['Enabled', '已启用'].includes(item.value))
)

