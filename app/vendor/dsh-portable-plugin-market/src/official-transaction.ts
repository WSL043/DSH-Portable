import { AsyncLocalStorage } from 'node:async_hooks'
import { PassThrough } from 'node:stream'
import { join, resolve } from 'node:path'
import { createDesktopPluginRuntime, type PluginCommandRuntime } from './dsh-cli.ts'

interface ProfileContext {
  name: string; dir: string; cwd: string; installAnchor: string
  packageManager?: { command?: string; args?: string[]; env?: Record<string, string> }
}
interface Operations {
  withFileLock<T>(file: string, fn: () => Promise<T>, options: { waitMs: number }): Promise<T>
  runProfilePnpm(context: object, args: readonly string[], options: {
    execution: 'service'; signal: AbortSignal; outputBytes: number; activateNewBundles: boolean
    command?: string; args?: string[]; env?: Record<string, string>
    onOutput(text: string, stream: 'stdout' | 'stderr'): void
  }): Promise<{ exitCode: number; output?: string }>
}
export interface OfficialTransactionRuntime extends PluginCommandRuntime {
  withMutation<T>(fn: () => Promise<T> | T): Promise<T>
  dispose(): Promise<void>
}
const loadOperations = async (): Promise<Operations> => {
  const [atomic, operations] = await Promise.all([
    import('@deepseek-ai/dsh-atomic-write'), import('@deepseek-ai/dsh-plugin-manager/operations'),
  ])
  return { withFileLock: atomic.withFileLock, runProfilePnpm: operations.runProfilePnpm }
}

/** One official profile lock spans snapshots, pnpm, validation and rollback. */
export function createOfficialTransactionRuntime(host: { get?(name: string): unknown }, dir: string,
  load = loadOperations): OfficialTransactionRuntime | null {
  const manager = host.get?.('pluginManager') as { listPlugins?: unknown; setPluginEnabled?: unknown; pnpmCommand?: unknown } | undefined
  if (typeof manager?.listPlugins !== 'function' || typeof manager?.setPluginEnabled !== 'function') return null
  const scope = new AsyncLocalStorage<{ operations: Operations; profile: ProfileContext; open: boolean }>()
  const runner = createDesktopPluginRuntime({
    runPlugin(args, _cwd, signal) {
      const active = scope.getStore()
      if (!active?.open) throw new Error('Official profile mutation lock is required')
      const abort = new AbortController()
      const stdout = new PassThrough(), stderr = new PassThrough()
      const done = Promise.resolve().then(async () => {
        let emitted = false
        const result = await active.operations.runProfilePnpm({ ...active.profile, profile: active.profile.name }, args, {
          execution: 'service', ...active.profile.packageManager,
          env: { ...active.profile.packageManager?.env, CI: 'true', GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
          signal: signal ? AbortSignal.any([signal, abort.signal]) : abort.signal,
          outputBytes: 256 * 1024, activateNewBundles: true,
          onOutput: (text, stream) => { emitted = true; (stream === 'stdout' ? stdout : stderr).write(text) },
        })
        // Spawn failures can be returned as diagnostics without an output event.
        if (!emitted && result.output) stderr.write(result.output)
        return { exitCode: result.exitCode, signal: null }
      }).finally(() => { stdout.end(); stderr.end() })
      return { stdout, stderr, done, cancel: () => abort.abort() }
    },
  }, dir)
  return {
    ...runner,
    async withMutation(fn) {
      const profile = host.get?.('profileContext') as ProfileContext | undefined
      if (!profile || typeof profile.dir !== 'string' || resolve(profile.dir) !== resolve(dir)
        || typeof profile.name !== 'string' || typeof profile.cwd !== 'string' || typeof profile.installAnchor !== 'string') {
        throw new Error('Official profile context does not match the market; mutation refused')
      }
      const operations = await load()
      let acquired = false
      try {
        return await operations.withFileLock(join(dir, 'package.json'), async () => {
          acquired = true
          const packageManager = profile.packageManager
            ?? (typeof manager.pnpmCommand === 'string' ? { command: manager.pnpmCommand } : undefined)
          const transaction = { operations, profile: { ...profile, packageManager }, open: true }
          try { return await scope.run(transaction, fn) }
          finally { transaction.open = false }
        }, { waitMs: 0 })
      } catch (error) {
        const contention = (error as NodeJS.ErrnoException).code === 'EEXIST'
          || (error instanceof Error && error.message.startsWith('atomic-write: timed out waiting for the writer lock at '))
        if (!acquired && contention) throw Object.assign(new Error('Another official plugin operation is using this profile; retry when it finishes.'), { code: 'PROFILE_BUSY', cause: error })
        throw error
      }
    },
  }
}
