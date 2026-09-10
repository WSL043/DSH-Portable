import { readFile, writeFile, rm, mkdir, appendFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { redactDiagnosticText } from './diagnostic-policy.mjs'

const files = ['package.json', 'pnpm-lock.yaml']
async function optionalFile(filename) {
  try { return await readFile(filename) } catch (error) { if (error.code === 'ENOENT') return null; throw error }
}

// Only the Portable CLI adapter calls this. Direct upstream Node/pnpm invocations
// do not pass through Portable and cannot be intercepted here.
export async function runCheckedPluginMutation({ profileRoot, layout, run, reinstall, preflight }) {
  const before = await Promise.all(files.map(name => optionalFile(path.join(profileRoot, name))))
  const log = async status => {
    try {
      await mkdir(layout.logsDir, { recursive: true })
      await appendFile(path.join(layout.logsDir, 'launcher.log'), `${new Date().toISOString()} [plugin-cli] ${redactDiagnosticText(status)}\n`)
    } catch { /* logging must not prevent recovery */ }
  }
  const result = await run()
  if (result.status !== 0) return result
  let verdict
  try {
    const manifest = JSON.parse(await readFile(path.join(profileRoot, 'package.json'), 'utf8'))
    const packages = (manifest.dsh?.profile?.bundles ?? []).filter(name => typeof name === 'string' && !name.startsWith('@deepseek-ai/'))
    const check = preflight ?? (await import(pathToFileURL(path.join(layout.pluginMarketRoot, 'lib', 'import-preflight.js')).href)).preflightPluginImports
    verdict = await check(profileRoot, packages, { node: layout.nodeExe, dshInstallDir: path.dirname(path.dirname(layout.dshBin)) })
  }
  catch (error) { verdict = { ok: false, detail: String(error) } }
  if (verdict.ok) { await log('import-check-passed'); return result }
  await log(`import-check-failed; restoring plugin manifest and lockfile: ${String(verdict.detail ?? '').slice(-4000)}`)
  for (let i = 0; i < files.length; i++) {
    const filename = path.join(profileRoot, files[i])
    if (before[i] === null) await rm(filename, { force: true })
    else await writeFile(filename, before[i])
  }
  // No previous profile means there is no previous dependency graph to install.
  const recovery = before[0] === null ? { status: 0 } : await reinstall().catch(error => ({ status: 1, stderr: String(error) }))
  const restored = recovery.status === 0
  await log(restored ? 'plugin-configuration-restored' : 'plugin-dependency-recovery-failed')
  return { ...result, status: 1, stderr: `${verdict.detail ?? 'Plugin import failed'}\n${restored ? 'Plugin configuration restored. Sessions and workspace were not rolled back.' : 'Plugin configuration restored, but dependency recovery failed.'}\n` }
}
