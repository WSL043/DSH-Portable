// Browser-side expression shared by native smoke scripts. Add newly shipped
// official first-run dialogs here once; scripts must not keep their own copy.
// Only these known prompts are dismissed, never arbitrary dialogs.
const NOTICE = /Internal Testing Notice|内测声明|Preview Notice|预览版说明|Add an API key to get started|添加 API 密钥|添加一个 API Key/i
const FINAL_STEP = /Add an API key to get started|添加 API 密钥|添加一个 API Key/i
const BUTTONS = ['Continue', '继续', 'Configure later', 'Set up later', '稍后配置']

// Evaluates to false when no known prompt is visible, otherwise
// { clicked, terminal }; terminal is true for the final "configure later" step.
export const dismissOfficialOnboardingExpression = `(() => {
  const notice = [...document.querySelectorAll('dialog,[role="dialog"],[role="alertdialog"]')]
    .find(item => item.getBoundingClientRect().width > 0 && ${NOTICE}.test(item.textContent || ''))
  if (!notice) return false
  const button = [...notice.querySelectorAll('button')].find(item =>
    ${JSON.stringify(BUTTONS)}.includes((item.textContent || '').trim())
    && !item.disabled && !item.closest('[inert],[aria-hidden="true"]'))
  button?.click()
  return { clicked: Boolean(button), terminal: ${FINAL_STEP}.test(notice.textContent || '') }
})()`
