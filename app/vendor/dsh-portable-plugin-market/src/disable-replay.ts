/** Legacy disable replay must never overrule the official plugin manager. */
export interface DisableReplayHost {
  get?(name: string): unknown
  on?(event: string, callback: (fiber: { entry?: { options?: { name?: string } } }) => void): () => void
}

export function createLegacyDisableReplay(host: DisableReplayHost, disabled: Set<string>,
  setDisabled: (name: string) => Promise<unknown>, warn: (error: unknown) => void) {
  let disposed = false
  const pending = new Map<string, Promise<void>>()
  const legacyOwnsState = () => {
    if (disposed) return false
    try {
      const manager = host.get?.('pluginManager') as { listPlugins?: unknown; setPluginEnabled?: unknown } | undefined
      return !(typeof manager?.listPlugins === 'function' && typeof manager?.setPluginEnabled === 'function')
    } catch { return false } // Unknown ownership is not permission to overwrite it.
  }
  const replay = (name: string): Promise<void> => {
    if (!legacyOwnsState() || !disabled.has(name)) return Promise.resolve()
    const current = pending.get(name)
    if (current) return current
    // Defer one microtask so an official service arriving during composition wins.
    const task = Promise.resolve().then(async () => {
      if (legacyOwnsState() && disabled.has(name)) await setDisabled(name)
    }).catch(warn).finally(() => { pending.delete(name) })
    pending.set(name, task)
    return task
  }
  const removeListener = host.on?.('internal/plugin', fiber => {
    const name = fiber.entry?.options?.name
    if (name !== undefined) void replay(name)
  })
  return {
    async replayAll() { for (const name of disabled) await replay(name) },
    dispose() { if (disposed) return; disposed = true; removeListener?.() },
  }
}
