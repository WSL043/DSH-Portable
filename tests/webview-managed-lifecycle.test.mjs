import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, writeFile, readFile, rename, access, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRuntimeCapsule } from '../scripts/create-runtime-capsule.mjs'
import { prepareManagedWebView, cleanWebViewCaches, webViewCacheEnvironment } from '../launcher/webview-cache.mjs'

async function owner() {
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { windowsHide: true, stdio: 'ignore' })
  await once(child, 'spawn')
  return { pid: child.pid, async stop() { if (child.exitCode !== null || child.signalCode !== null) return; const closed = once(child, 'close'); child.kill(); await closed } }
}

test('managed WebView generations protect native-to-browser handoff and preserve legacy/profile data', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'webview-managed-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const env = { ...process.env, DSH_PORTABLE_WEBVIEW_CACHE: path.join(root, 'webview2-cache') }
  const host = await owner(), browser = await owner()
  t.after(async () => { await host.stop(); await browser.stop() })
  const products = []
  for (const version of ['old', 'current']) {
    const product = path.join(root, version)
    const app = path.join(product, 'source')
    await mkdir(app, { recursive: true })
    await writeFile(path.join(app, 'msedgewebview2.exe'), version)
    const capsule = path.join(product, 'runtime/webview2')
    await createRuntimeCapsule(app, path.join(capsule, 'WebView2.dshpack'), path.join(capsule, 'runtime-capsule.json'), { level: 1, required: ['app/msedgewebview2.exe'] })
    products.push(product)
  }
  const legacy = path.join(env.DSH_PORTABLE_WEBVIEW_CACHE, 'a'.repeat(64), 'app')
  await mkdir(legacy, { recursive: true })
  await writeFile(path.join(legacy, 'keep'), 'legacy')
  const profile = path.join(root, 'data/browser')
  await mkdir(profile, { recursive: true })
  for (const file of ['Cookies', 'LocalStorage', 'IndexedDB']) await writeFile(path.join(profile, file), file)
  const old = await prepareManagedWebView(products[0], host.pid, { env })
  await prepareManagedWebView(products[1], process.pid, { env })
  assert.equal((await cleanWebViewCaches(products[1], { env })).retained.find(item => item.hash === path.basename(old.runtimeRoot)).reason, 'active')
  await prepareManagedWebView(products[0], browser.pid, { env, leaseOnly: true })
  await host.stop()
  assert.equal((await cleanWebViewCaches(products[1], { env })).removed.length, 0)
  await access(path.join(old.runtimeRoot, 'app/msedgewebview2.exe'))
  await browser.stop()
  // Crash after ready marker but before ownership commit is recoverable.
  await rename(path.join(old.runtimeRoot, '.webview-managed-v1.json'), old.runtimeRoot + '.webview-managed-v1.json')
  const unknown = path.join(webViewCacheEnvironment(env).DSH_PORTABLE_RUNTIME_CACHE, 'b'.repeat(64))
  await mkdir(unknown)
  await writeFile(path.join(unknown, 'keep'), 'unknown')
  const orphan = await cleanWebViewCaches(products[1], { env, inspectProcesses: async () => [{ ExecutablePath: path.join(old.runtimeRoot, 'app/msedgewebview2.exe') }] })
  assert.equal(orphan.removed.length, 0, 'unregistered live browser must protect its executable')
  const uncertain = await cleanWebViewCaches(products[1], { env, inspectProcesses: async () => [{ ExecutablePath: null }] })
  assert.equal(uncertain.removed.length, 0, 'unknown process ownership must preserve runtime')
  const cleaned = await cleanWebViewCaches(products[1], { env, inspectProcesses: async () => [] })
  assert.equal(cleaned.removed.length, 1)
  assert.equal(cleaned.retained.find(item => item.hash === 'b'.repeat(64)).reason, 'unknown-owner')
  await assert.rejects(access(old.runtimeRoot), { code: 'ENOENT' })
  assert.equal(await readFile(path.join(legacy, 'keep'), 'utf8'), 'legacy')
  for (const file of ['Cookies', 'LocalStorage', 'IndexedDB']) assert.equal(await readFile(path.join(profile, file), 'utf8'), file)
  await assert.rejects(prepareManagedWebView(products[1], 0, { env }), /owner is not alive/)
})
