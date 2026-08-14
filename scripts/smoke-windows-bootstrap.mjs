import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { mkdtemp, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const projectRoot = path.resolve(import.meta.dirname, '..')
const artifacts = path.resolve(process.argv[2] || path.join(projectRoot, 'artifacts'))
const bootstrap = path.join(artifacts, 'DSH-Portable-windows-x64.exe')
const sourceManifest = JSON.parse(await readFile(path.join(artifacts, 'portable-manifest.json'), 'utf8'))
const sourcePayload = sourceManifest?.payloads?.windowsX64

assert.equal(process.platform, 'win32', 'the lightweight bootstrap smoke test requires Windows')
assert.ok(sourcePayload?.filename, 'portable-manifest.json is missing the Windows payload')

const payload = path.join(artifacts, sourcePayload.filename)
const payloadBytes = await readFile(payload)
assert.equal(payloadBytes.length, sourcePayload.bytes, 'manifest payload size does not match the built ZIP')
assert.equal(
  createHash('sha256').update(payloadBytes).digest('hex'),
  sourcePayload.sha256,
  'manifest payload digest does not match the built ZIP',
)

let manifestBody = null
const server = createServer((request, response) => {
  if (request.url === '/portable-manifest.json') {
    response.writeHead(200, { 'content-type': 'application/json', 'content-length': manifestBody.length })
    response.end(manifestBody)
    return
  }
  if (request.url === '/payload.zip') {
    response.writeHead(200, { 'content-type': 'application/zip', 'content-length': payloadBytes.length })
    createReadStream(payload).pipe(response)
    return
  }
  response.writeHead(404).end()
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
manifestBody = Buffer.from(JSON.stringify({
  ...sourceManifest,
  payloads: {
    ...sourceManifest.payloads,
    windowsX64: { ...sourcePayload, url: `${origin}/payload.zip` },
  },
}), 'utf8')

const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-bootstrap-product-'))
const parent = path.join(root, '验证 中文 空格')
const destination = path.join(parent, 'DSH-Portable')
const resultFile = path.join(root, 'result.json')

try {
  await mkdir(parent, { recursive: true })
  await execFileAsync(bootstrap, [
    '--manifest', `${origin}/portable-manifest.json`,
    '--destination', destination,
    '--allow-http',
    '--no-launch',
    '--result', resultFile,
  ], { timeout: 10 * 60 * 1000, windowsHide: true })

  const installed = JSON.parse(await readFile(resultFile, 'utf8'))
  assert.equal(installed.status, 'installed')
  assert.equal(installed.version, sourceManifest.version)
  assert.deepEqual(
    (await readdir(parent)).filter((name) => name.startsWith('.dsh-portable-install-')),
    [],
    'the product bootstrap left a staging directory behind',
  )
  assert.ok((await stat(path.join(destination, 'DeepSeek-Herness.exe'))).isFile())

  await execFileAsync(bootstrap, [
    '--manifest', 'http://127.0.0.1:1/unreachable.json',
    '--destination', destination,
    '--allow-http',
    '--no-launch',
    '--result', resultFile,
  ], { timeout: 60 * 1000, windowsHide: true })
  const reused = JSON.parse(await readFile(resultFile, 'utf8'))
  assert.equal(reused.status, 'ready')

  await execFileAsync(process.execPath, [path.join(projectRoot, 'scripts', 'smoke-portable.mjs'), destination], {
    timeout: 10 * 60 * 1000,
    windowsHide: true,
  })

  console.log(JSON.stringify({
    status: 'passed',
    version: sourceManifest.version,
    bootstrapBytes: (await stat(bootstrap)).size,
    payloadBytes: payloadBytes.length,
  }))
} finally {
  await new Promise((resolve) => server.close(resolve))
  await rm(root, { recursive: true, force: true, maxRetries: 40, retryDelay: 100 })
}
