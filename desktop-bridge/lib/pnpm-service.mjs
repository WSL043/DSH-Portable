const override = '--config.minimumReleaseAge=0'
export async function runWithReleaseAgeRecovery(args, run, cancelled = () => false) {
  const first = await run(args)
  if (first.exitCode === 0 || cancelled() || first.signal
    || args.some(arg => /minimumReleaseAge=|minimum-release-age=/.test(arg))
    || !['add', 'install', 'remove', 'rm', 'uninstall', 'update', 'up'].includes(args[0])
    || !String(first.output).includes('ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION')) return first
  return run([args[0], override, ...args.slice(1)])
}

/** Temporary 0.1.7 host adapter. Retain the official lock, cancellation,
 * output and reconciliation; remove when upstream recovers this failure.
 * No subprocess shim, which would weaken cancellation on Windows.
 */
export function installOfficialPnpmRecovery(manager) {
  if (typeof manager?.runPnpm !== 'function') return undefined
  const original = manager.runPnpm
  let disposed = false
  async function wrapped(args, signal, requestId) {
    return runWithReleaseAgeRecovery(args,
      retry => Reflect.apply(original, this, [retry, signal, requestId]),
      () => disposed || signal?.aborted === true || this.abort?.signal?.aborted === true)
  }
  manager.runPnpm = wrapped
  return () => {
    disposed = true
    if (manager.runPnpm === wrapped) manager.runPnpm = original
  }
}
