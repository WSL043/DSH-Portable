const override = '--config.minimumReleaseAge=0'
export async function runWithReleaseAgeRecovery(args, run, cancelled = () => false) {
  const first = await run(args)
  const command = args[0]
  const output = String(first.output)
  const releaseAgeLockFailure = output.includes('ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION')
  // Bundled pnpm may fail while removing a package because its resolver has no
  // release-age violation callback. A removal cannot introduce a new target.
  const removalPolicyCallbackFailure = ['remove', 'rm', 'uninstall'].includes(command)
    && output.includes('ERR_PNPM_RESOLUTION_POLICY_VIOLATIONS_UNHANDLED')
  if (first.exitCode === 0 || cancelled() || first.signal
    || args.some(arg => /minimumReleaseAge=|minimum-release-age=/.test(arg))
    || !['add', 'install', 'remove', 'rm', 'uninstall', 'update', 'up'].includes(command)
    || !(releaseAgeLockFailure || removalPolicyCallbackFailure)) return first
  return run([command, override, ...args.slice(1)])
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
