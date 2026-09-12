import { spawn } from 'node:child_process'

// Out-of-process UI Automation providers may block in native code. Preserve the image
// already emitted, terminate this one helper, and explicitly report incomplete text.
export function captureAppshot(executable, target, { timeoutMs = 6000, signal, onImage, spawnProcess = spawn } = {}) {
  if (!/^[1-9]\d*$/.test(String(target.window)) || !/^[1-9]\d*$/.test(String(target.pid))) {
    return Promise.reject(new Error('A latched window handle and owner process are required.'))
  }
  if (signal?.aborted) return Promise.reject(new Error('Appshot cancelled.'))
  return new Promise((resolve, reject) => {
    const child = spawnProcess(executable, [String(target.window), String(target.pid)], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let image, text, failure, buffer = '', bytes = 0, timedOut = false, cancelled = false
    const abort = () => { cancelled = true; child.kill() }
    const timer = setTimeout(() => { timedOut = true; child.kill() }, timeoutMs)
    signal?.addEventListener('abort', abort, { once: true })
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      bytes += Buffer.byteLength(chunk)
      if (bytes > 24 * 1024 * 1024) { failure = 'Capture output exceeds its limit.'; child.kill(); return }
      buffer += chunk
      for (let end; (end = buffer.indexOf('\n')) >= 0;) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1)
        try {
          const message = JSON.parse(line)
          if (message.type === 'image' && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(message.dataUrl) && !image) {
            image = message; onImage?.(message)
          } else if (message.type === 'text' && typeof message.text === 'string' && message.text.length <= 24000) text = message
          else if (message.type === 'error') failure = message.message || 'Native capture failed.'
        } catch { failure = 'Invalid native capture response.'; child.kill() }
      }
    })
    child.stderr.resume()
    child.on('error', error => { cleanup(); reject(error) })
    child.on('close', code => {
      cleanup()
      if (cancelled) return reject(new Error('Appshot cancelled.'))
      if (!image) return reject(new Error(failure || (timedOut ? 'Capture timed out.' : `Capture exited (${code}).`)))
      resolve({ image, text: text?.text || '', textPartial: !text || text.partial === true,
        warning: failure || (timedOut ? 'Window text timed out; image is available.' : code !== 0 ? `Text capture exited (${code}).` : !text ? 'Window text was not returned.' : null), exitCode: code })
    })
  })
}
