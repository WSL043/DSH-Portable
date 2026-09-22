import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

async function loadOperations(layout) {
  const require = createRequire(path.join(layout.appDir, 'package.json'))
  const load = name => import(pathToFileURL(require.resolve(name)).href)
  const [atomic, operations, boot] = await Promise.all([
    load('@deepseek-ai/dsh-atomic-write'),
    load('@deepseek-ai/dsh-plugin-manager/operations'),
    load('@deepseek-ai/dsh-app-boot'),
  ])
  return { ...atomic, ...operations, ...boot }
}

/** Modern CLI operations share the profile writer with the running official manager.
 * The callback must await every package command, validation and recovery operation.
 * No nested CLI invocation is allowed while this lock is held.
 */
export async function withPluginProfileTransaction(spec, profile, callback, load = loadOperations) {
  const dir = path.resolve(spec.layout.dshHome, 'profiles', profile)
  const relative = path.relative(path.join(spec.layout.dshHome, 'profiles'), dir)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('Invalid plugin profile path.')
  const api = await load(spec.layout)
  await mkdir(dir, { recursive: true })
  return api.withFileLock(path.join(dir, 'package.json'), async () => {
    if (!existsSync(path.join(dir, 'package.json'))) {
      api.initProfile(dir, api.PROFILE_TEMPLATES[profile]?.bundles ?? api.DEFAULT_PROFILE_BUNDLES)
    }
    let active = true
    const run = async (commandSpec, options) => {
      if (!active) throw Error('Plugin profile transaction has already ended.')
      // makeSpec always supplies [officialBin, plugin, --profile, name, ...pnpmArgs].
      const args = commandSpec.args
      if (args[1] !== 'plugin' || args[2] !== '--profile' || args[3] !== profile) {
        throw Error('Plugin command does not match the locked profile.')
      }
      let stdout = '', stderr = '', emitted = false
      const result = await api.runProfilePnpm({ dir, profile, cwd: commandSpec.cwd,
        home: spec.layout.dshHome, installAnchor: path.join(path.dirname(path.dirname(spec.layout.dshBin)), 'package.json') },
      args.slice(4), {
        execution: 'service', activateNewBundles: true, outputBytes: 1024 * 1024,
        env: commandSpec.env,
        onOutput(text, stream) {
          emitted = true
          if (stream === 'stdout') { stdout = (stdout + text).slice(-1024 * 1024); options.stdout.write(text) }
          else { stderr = (stderr + text).slice(-1024 * 1024); if (options.mirrorStderr) options.stderr.write(text) }
        },
      })
      if (!emitted && result.output) { stderr = result.output; if (options.mirrorStderr) options.stderr.write(stderr) }
      return { status: result.exitCode, stdout, stderr }
    }
    try { return await callback(run) }
    finally { active = false }
  }, { waitMs: 0 })
}
