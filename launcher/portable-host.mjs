import { timingSafeEqual } from 'node:crypto'
import http from 'node:http'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const [dshBin, ...dshArgs] = process.argv.slice(2)
const controlPipe = process.env.DSH_PORTABLE_CONTROL_PIPE
const controlToken = process.env.DSH_PORTABLE_CONTROL_TOKEN

if (!dshBin) throw new Error('portable host requires the official DSH bin path')
if (!controlPipe || !controlToken) throw new Error('portable host control channel is not configured')

function tokenMatches(header) {
  const supplied = Buffer.from(String(header ?? '').replace(/^Bearer\s+/i, ''), 'utf8')
  const expected = Buffer.from(controlToken, 'utf8')
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
}

let shutdownAccepted = false
const control = http.createServer((request, response) => {
  if (request.method !== 'POST' || request.url !== '/shutdown') {
    response.writeHead(404).end()
    return
  }
  if (!tokenMatches(request.headers.authorization)) {
    response.writeHead(401).end()
    return
  }
  response.writeHead(202).end()
  if (shutdownAccepted) return
  shutdownAccepted = true
  control.close()
  setImmediate(() => {
    if (!process.emit('SIGTERM')) process.exit(0)
  })
})
control.on('clientError', (_error, socket) => socket.destroy())

await new Promise((resolve, reject) => {
  control.once('error', reject)
  control.listen(controlPipe, () => {
    control.off('error', reject)
    resolve()
  })
})

process.argv = [process.execPath, path.resolve(dshBin), ...dshArgs]
try {
  await import(pathToFileURL(path.resolve(dshBin)).href)
} catch (error) {
  control.close()
  throw error
}
