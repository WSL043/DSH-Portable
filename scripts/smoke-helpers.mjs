import { rename } from 'node:fs/promises'

const transientWindowsRenameErrors = new Set(['EACCES', 'EBUSY', 'EPERM'])

export async function renameWithRetry(source, destination, options = {}) {
  const platform = options.platform ?? process.platform
  const attempts = options.attempts ?? 40
  const renameFn = options.renameFn ?? rename
  const waitFn = options.waitFn ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await renameFn(source, destination)
      return
    } catch (error) {
      const transient = platform === 'win32' && transientWindowsRenameErrors.has(error?.code)
      if (!transient || attempt === attempts) throw error
      await waitFn(Math.min(attempt * 100, 500))
    }
  }
}
