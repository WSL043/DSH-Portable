import assert from 'node:assert/strict'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { mountPortableRoutes } from '../desktop-bridge/lib/index.js'

const root = path.resolve(process.argv[2] || '')
if (!process.argv[2]) throw new Error('usage: node smoke-capsule-maintenance.mjs <isolated product root>')
const routes = new Map()
const dispose = mountPortableRoutes({ register(route) { routes.set(route.path, route); return () => {} } }, {
  root, stateRoot: root, notificationAvailability: async () => ({ status: 'unavailable' }),
})
const output = path.join(root, 'data', `诊断 smoke ${process.pid}.json`)
async function invoke(name, body = null) {
  let status
  let result
  await routes.get(`/dsh-portable/${name}`).handler({
    method: 'POST',
    headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' },
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() { if (body) yield Buffer.from(JSON.stringify(body)) },
  }, {
    writeHead(code) { status = code },
    end(value) { result = JSON.parse(String(value)) },
  })
  assert.equal(status, 200, JSON.stringify(result))
  return result
}
try {
  // The handler must resolve the capsule independently of inherited runtime state.
  const diagnosis = await invoke('doctor')
  assert.equal(diagnosis.needsFullPackage, false, JSON.stringify(diagnosis.checks))
  assert.equal(diagnosis.ok, true, JSON.stringify(diagnosis.checks))
  await invoke('support-report', { output })
  const report = JSON.parse(await readFile(output, 'utf8'))
  assert.equal(report.diagnosis.ok, true)
  assert.equal(report.files.dsh.present, true)
  console.log(JSON.stringify({ status: 'passed', runtimeFilesPresent: true, unicodeOutput: true, checks: diagnosis.checks.length }))
} finally {
  dispose()
  await rm(output, { force: true })
}
