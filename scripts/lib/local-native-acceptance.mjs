// Local attachment only: process creation and OS ownership stay in the verified private worker.
import assert from 'node:assert/strict'
import { readFile, realpath } from 'node:fs/promises'
import { safeDataTarget, writeDataFileAtomic } from '../../launcher/data-paths.mjs'

const languageNames = {
  en: ['English'],
  zh: ['中文', '简体中文', '中文（简体）', 'Chinese', 'Simplified Chinese'],
}
const exactNames = names => new RegExp('^(?:' + names.map(name => name.replace(/[.*+?^$()|[\]\\]/g, '\\$&')).join('|') + ')$')
const identityKeys = ['root', 'pid', 'startedAt', 'hostSha256', 'artifactSha256', 'desktop', 'inputDesktop', 'origin', 'user']
const selectIdentity = value => Object.fromEntries(identityKeys.map(key => [key, value[key]]))

function selectedLanguage({ names, target }) {
  const controls = [...document.querySelectorAll('button,[role="button"]')].filter(item => {
    const box = item.getBoundingClientRect()
    return box.width > 0 && box.height > 0 && !item.disabled
      && !item.closest('[role="menu"],[role="listbox"],[role="option"],[role="menuitem"],[inert],[aria-hidden="true"]')
      && getComputedStyle(item).visibility === 'visible'
  }).map(item => (item.getAttribute('aria-label') || item.textContent || '').trim())
    .filter(label => Object.values(names).flat().includes(label))
  const locale = controls.length === 1 ? Object.keys(names).find(key => names[key].includes(controls[0])) : null
  return target ? locale === target : locale
}

export async function openLocalNativeAcceptance({ page, identity, verifyOwner, timeoutMs = 3000 }) {
  assert.equal(typeof verifyOwner, 'function', 'a live private-worker ownership probe is required')
  assert.ok(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 3000, 'UI timeout must be 1–3000 ms')
  const expected = selectIdentity({ ...identity, root: await realpath(identity.root) })
  assert.ok(Number.isInteger(expected.pid) && expected.pid > 0 && expected.startedAt, 'pin the owned native PID and start time')
  assert.match(expected.hostSha256, /^[a-f0-9]{64}$/, 'pin the original native executable hash')
  assert.match(expected.artifactSha256, /^[a-f0-9]{64}$/, 'pin the verified package artifact hash')
  assert.match(expected.desktop, /^DSH-[\w-]+$/, 'use a named private DSH desktop')
  assert.equal(expected.inputDesktop, 'Default', 'do not automate a locked or secure input desktop')
  assert.ok(expected.user, 'pin the worker user')
  const origin = new URL(expected.origin)
  assert.ok(origin.protocol === 'http:' && origin.hostname === '127.0.0.1' && origin.port && expected.origin === origin.origin,
    'pin the owned loopback page origin, without credentials or query data')
  const guard = async () => {
    const proof = await verifyOwner()
    assert.deepEqual(selectIdentity(proof), expected, 'owned fixture identity changed')
    assert.equal(proof.workerDesktop, expected.desktop, 'worker left its private desktop')
    assert.equal(proof.hostDesktop, expected.desktop, 'native host is on another desktop')
    assert.equal(proof.creationFlags & 0x08000400, 0x08000400, 'worker requires CREATE_NO_WINDOW and Unicode environment')
    assert.equal(new URL(page.url()).origin, expected.origin, 'page does not belong to the owned fixture')
  }
  await guard()
  page.setDefaultTimeout(timeoutMs)
  page.setDefaultNavigationTimeout(timeoutMs)
  const file = await safeDataTarget(expected.root, 'acceptance/local-native-' + expected.pid + '.json')
  let journal = { schemaVersion: 1, identity: expected, phases: {} }
  try {
    journal = JSON.parse(await readFile(file, 'utf8'))
    assert.equal(journal.schemaVersion, 1)
    assert.ok(journal.phases && typeof journal.phases === 'object' && !Array.isArray(journal.phases), 'invalid phase checkpoint')
    assert.deepEqual(journal.identity, expected, 'checkpoint belongs to another fixture or native process')
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  const save = () => writeDataFileAtomic(file, JSON.stringify(journal, null, 2) + '\n')
  const dialogs = async () => {
    await guard()
    return page.evaluate(() => [...document.querySelectorAll('[role="dialog"]')].filter(item => {
      const box = item.getBoundingClientRect()
      return box.width > 0 && box.height > 0 && !item.closest('[inert],[aria-hidden="true"]')
        && getComputedStyle(item).visibility === 'visible'
    }).slice(-5).map(item => ({
      label: (item.getAttribute('aria-label') || '').slice(0, 100),
      buttons: [...item.querySelectorAll('button')].slice(0, 12)
        .map(button => (button.getAttribute('aria-label') || button.textContent || '').trim().slice(0, 80)),
    })))
  }
  let active = false
  const step = async (name, action, { recheck, retry = false } = {}) => {
    assert.match(name, /^[a-z0-9][a-z0-9-]{0,63}$/)
    assert.ok(!active, 'run one owned UI phase at a time')
    active = true
    try {
      await guard()
      const previous = journal.phases[name]
      if (previous?.status === 'passed') {
        assert.equal(typeof recheck, 'function', 'resuming a passed phase requires a live read-only recheck')
        assert.equal(await recheck(), true, 'completed phase no longer holds; inspect before repeating')
        await guard()
        return { resumed: true }
      }
      assert.ok(!previous || retry, 'interrupted or failed phase requires inspection and explicit retry')
      journal.phases[name] = { status: 'running', startedAt: new Date().toISOString() }
      await save()
      const started = Date.now()
      try {
        const value = await action()
        await guard()
        Object.assign(journal.phases[name], { status: 'passed', elapsedMs: Date.now() - started })
        await save()
        return { resumed: false, value }
      } catch (error) {
        Object.assign(journal.phases[name], { status: 'failed', elapsedMs: Date.now() - started, error: error.name })
        try { journal.phases[name].dialogs = await dialogs() } catch { /* ownership loss must not trigger page inspection */ }
        await save()
        throw error
      }
    } finally { active = false }
  }
  const languageIs = async target => {
    assert.ok(languageNames[target], 'supported acceptance locales are en and zh')
    await guard()
    return page.evaluate(selectedLanguage, { names: languageNames, target })
  }
  const setLanguage = async target => {
    assert.ok(languageNames[target], 'supported acceptance locales are en and zh')
    await guard()
    await page.getByRole('button', { name: /^(General|General settings|通用设置)$/ }).click({ timeout: timeoutMs })
    if (await languageIs(target)) return { changed: false }
    await page.getByRole('button', { name: exactNames(Object.values(languageNames).flat()) }).click({ timeout: timeoutMs })
    const name = exactNames(languageNames[target])
    await page.getByRole('option', { name }).or(page.getByRole('menuitem', { name })).or(page.getByRole('button', { name }))
      .click({ timeout: timeoutMs })
    await page.waitForFunction(selectedLanguage, { names: languageNames, target }, { timeout: timeoutMs })
    return { changed: true }
  }
  const dismissKeylessOnboarding = async () => {
    await guard()
    const closeNames = { 'Get started': 'Close', '开始使用': '关闭' }
    const modal = page.getByRole('dialog', { name: exactNames(Object.keys(closeNames)) })
    try { await modal.waitFor({ state: 'visible', timeout: Math.min(timeoutMs, 1500) }) }
    catch (error) { if (error.name === 'TimeoutError') return { dismissed: false }; throw error }
    const closeName = closeNames[await modal.getAttribute('aria-label', { timeout: timeoutMs })]
    assert.ok(closeName, 'unknown keyless onboarding label')
    await modal.getByRole('button', { name: closeName, exact: true }).click({ timeout: timeoutMs })
    await modal.waitFor({ state: 'hidden', timeout: timeoutMs })
    return { dismissed: true }
  }
  return { step, dialogs, languageIs, setLanguage, dismissKeylessOnboarding, checkpointFile: file }
}
