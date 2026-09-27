import { fork, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'

// A worker is registered durably BEFORE it may launch the installer. If the
// importer dies, recovery can see this live owner and cannot race its writes.
export function runImportCommand(command, args, options, beforeStart) {
  return new Promise((resolve, reject) => {
    const token = randomBytes(16).toString('hex')
    const worker = fork(fileURLToPath(import.meta.url), ['--import-worker', token], {
      // Windows detached children can allocate a new console despite hiding
      // flags. Keep this worker in the parent's hidden process job instead.
      execPath: process.execPath, execArgv: [], windowsHide: true, detached: process.platform !== 'win32',
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    })
    let result
    worker.once('error', reject)
    worker.on('message', async message => {
      if (message?.ready) {
        try {
          await beforeStart(worker.pid, token)
          worker.send({ command, args, options })
        } catch (error) {
          worker.disconnect()
          reject(error)
        }
      } else if (message?.result) result = message.result
    })
    worker.once('exit', code => {
      if (!result) return reject(Object.assign(new Error(`Import dependency worker exited (${code}).`), { code: 'DSH_DATA_IMPORT_WORKER_FAILED' }))
      if (result.error) return reject(Object.assign(new Error(result.error.message), result.error))
      resolve({ stdout: result.stdout, stderr: result.stderr })
    })
  })
}

if (process.argv[2] === '--import-worker' && process.send) {
  let started = false
  process.on('disconnect', () => { if (!started) process.exit(0) })
  process.once('message', ({ command, args, options }) => {
    started = true
    // Keep running after importer disconnect so the registered PID protects
    // profile writes until the official installer finishes or its timeout ends.
    let timedOut = false
    let stopping = Promise.resolve()
    const timeoutMs = Number(options.timeout) || 180_000
    const { timeout, maxBuffer, encoding, ...spawnOptions } = options
    const limit = Math.max(1024, Math.min(Number(maxBuffer) || 4 * 1024 * 1024, 4 * 1024 * 1024))
    const child = spawn(command, args, { ...spawnOptions, windowsHide: true,
      detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = '', spawnError = null
    // Bound diagnostics without killing just the immediate process on a
    // maxBuffer error and accidentally releasing its descendant-write guard.
    child.stdout.on('data', bytes => { stdout = (stdout + bytes.toString()).slice(-limit) })
    child.stderr.on('data', bytes => { stderr = (stderr + bytes.toString()).slice(-limit) })
    child.once('error', error => { spawnError = error })
    child.once('close', async (code, signal) => {
      clearTimeout(timer)
      await stopping
      const failure = timedOut ? Object.assign(new Error('Import dependency operation timed out.'), { code: 'ETIMEDOUT' })
        : spawnError ?? (code === 0 ? null : Object.assign(new Error(`Import dependency operation failed (${code ?? signal}).`), { code }))
      const result = { stdout, stderr, ...(failure ? { error: {
        message: failure.message, code: failure.code, stdout, stderr,
      } } : {}) }
      if (process.connected) process.send({ result }, () => process.exit(failure ? 1 : 0))
      else process.exit(failure ? 1 : 0)
    })
    const timer = setTimeout(() => {
      timedOut = true
      if (process.platform === 'win32' && child.pid) {
        stopping = new Promise(resolve => {
          const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
          killer.once('error', resolve)
          killer.once('exit', resolve)
        })
      } else if (child.pid) {
        try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') }
      }
    }, timeoutMs)
  })
  process.send({ ready: true })
}
