import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { captureAppshot } from './capture.mjs'

export const name = 'portable-appshots'
export const inject = ['webServer']

export function apply(ctx) {
  if (process.platform !== 'win32' || !process.env.DSH_PORTABLE_ROOT) return
  ctx.effect(() => {
    const directory = path.resolve(import.meta.dirname, '../native')
    const subscribers = new Set()
    let current = null, controller = null, expiry, ready = false, disposed = false
    const notify = () => { for (const response of subscribers) response.write(`data: ${JSON.stringify({ id: current?.id, state: current?.state, ready })}\n\n`) }
    const clear = () => { controller?.abort(); controller = null; clearTimeout(expiry); current = null; notify() }
    const hook = spawn(path.join(directory, 'appshot-hotkey.exe'), [String(process.pid), process.env.DSH_PORTABLE_ROOT], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] })
    hook.stdin.on('error', () => {})
    hook.on('error', error => { console.warn('[appshots] hotkey unavailable:', error.code); ready = false; notify() })
    hook.on('close', () => { ready = false; if (!disposed) notify() })
    const focus = () => { if (current?.preview && (current.image || current.state === 'error') && !current.focused) { current.focused = true; hook.stdin.write('focus\n') } }
    hook.stdout.setEncoding('utf8'); let buffer = ''
    const start = async target => {
      if (controller) return // One gesture / one capture; do not queue key repeats.
      clearTimeout(expiry)
      const id = randomUUID(); const abort = new AbortController(); controller = abort
      current = { id, state: 'capturing', title: target.title, createdAt: Date.now(), preview: false }; notify()
      try {
        const result = await captureAppshot(path.join(directory, 'appshot-capture.exe'), target, {
          signal: abort.signal,
          onImage: image => {
            if (current?.id !== id) return
            Object.assign(current, { state: 'reading-text', image }); notify()
            focus()
          },
        })
        if (current?.id === id) { Object.assign(current, result, { state: 'ready' }); notify() }
        console.info('[appshots] capture completed; textPartial=' + result.textPartial)
      } catch (error) {
        if (current?.id === id) { Object.assign(current, { state: 'error', error: error.message }); notify(); focus() }
      } finally {
        if (controller === abort) controller = null
        if (current?.id === id) { clearTimeout(expiry); expiry = setTimeout(clear, 120000) }
      }
    }
    hook.stdout.on('data', chunk => {
      buffer += chunk
      if (buffer.length > 16384) { buffer = ''; return }
      for (let end; (end = buffer.indexOf('\n')) >= 0;) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1)
        try { const message = JSON.parse(line); if (message.type === 'ready') { ready = true; notify() }
          else if (message.type === 'target') void start(message)
          else if (message.type === 'released' && current) { current.preview = true; notify(); focus() }
          else if (message.type === 'cancel') clear()
        } catch { console.warn('[appshots] invalid hotkey event') }
      }
    })
    const disposers = []
    for (const route of ['events', 'pending', 'dismiss']) {
      disposers.push(ctx.webServer.register({ kind: 'exact', path: '/portable-appshots/' + route, handler: (request, response) => {
        response.setHeader('Cache-Control', 'no-store')
        const remote = request.socket?.remoteAddress
        const origin = request.headers.origin
        const trusted = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)
          && request.headers['sec-fetch-site'] !== 'cross-site'
          && (!origin || origin === `http://${request.headers.host}`)
        if (!trusted) { response.writeHead(403); response.end(); return }
        if (request.method !== (route === 'dismiss' ? 'POST' : 'GET')) { response.writeHead(405); response.end(); return }
        if (route === 'events') {
          response.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' })
          subscribers.add(response); response.write(`data: ${JSON.stringify({ id: current?.id, state: current?.state, ready })}\n\n`)
          const heartbeat = setInterval(() => response.write(': keepalive\n\n'), 20000)
          response.on('close', () => { clearInterval(heartbeat); subscribers.delete(response) }); return
        }
        if (route === 'dismiss') {
          if (current && request.headers['x-appshot-id'] !== current.id) { response.writeHead(409); response.end(); return }
          clear()
        }
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        response.end(JSON.stringify(route === 'pending' ? { ready, capture: current } : { ok: true }))
      } }))
    }
    return () => { disposed = true; clear(); hook.stdin.end(); hook.kill(); for (const response of subscribers) response.end(); for (const dispose of disposers.reverse()) dispose?.() }
  })
}
