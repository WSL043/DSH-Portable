import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'

const root = new URL('../', import.meta.url)
const marketRoot = new URL('app/vendor/dsh-portable-plugin-market/', root)

test('market render failures are isolated, reported once, and manually retryable', async () => {
  const [boundary, index, routes] = await Promise.all([
    readFile(new URL('src/client/MarketErrorBoundary.tsx', marketRoot), 'utf8'),
    readFile(new URL('src/client/index.ts', marketRoot), 'utf8'),
    readFile(new URL('src/routes.ts', marketRoot), 'utf8'),
  ])

  assert.match(boundary, /extends Component<MarketErrorBoundaryProps, MarketErrorBoundaryState>/)
  assert.match(boundary, /static getDerivedStateFromError\(\)/)
  assert.match(boundary, /componentDidCatch\(error: Error\)/)
  assert.match(boundary, /fetch\('\/dsh-market\/client-error'/)
  assert.match(boundary, /message: String\(error\.message\)\.slice\(0, 600\)/)
  assert.match(boundary, /<div role="alert">/)
  assert.match(boundary, /Portable 设置导出诊断/)
  assert.match(boundary, /Go to Portable Settings to export diagnostics/)
  assert.match(boundary, /重试 \/ Retry/)
  assert.match(boundary, /setState\(\{ failed: false \}\)/)
  assert.equal((boundary.match(/<button\b/g) ?? []).length, 1)
  assert.match(index, /h\(MarketErrorBoundary, \{ view: 'discover' \}, h\(MarketSection/)
  assert.match(index, /h\(MarketErrorBoundary, \{ view: 'installed' \}, h\(MarketSection/)

  const route = routes.slice(routes.indexOf("path: '/dsh-market/client-error'"))
  assert.match(route, /kind: 'exact'/)
  assert.match(route, /request\.method !== 'POST'/)
  assert.match(route, /sameOrigin\(request\)/)
  assert.match(route, /readJsonBody\(request\)/)
  assert.match(route, /view !== 'discover' && view !== 'installed'/)
  assert.match(route, /typeof message !== 'string'/)
  assert.match(route, /message\.length < 1 \|\| message\.length > 600/)
  assert.match(route, /logEvent\('error', 'client-render', `\$\{view\}: \$\{message\}`\)/)
  assert.match(route, /sendJson\(response, 200, \{ ok: true \}\)/)
  assert.match(route, /sendJson\(response, 400, \{ error: 'invalid client error payload' \}\)/)
})

test('logEvent sanitizes controls and API keys before stdout receives the entry', async () => {
  const source = await readFile(new URL('src/log.ts', marketRoot), 'utf8')
  const constants = source.match(/const MAX_ENTRIES = 200[\s\S]*?const entries: LogEntry\[\] = \[\]/)?.[0]
  const sanitize = source.match(/function sanitize\(text: string\): string \{[\s\S]*?\n\}/)?.[0]
  const logEvent = source.match(/export function logEvent\(level: LogLevel, event: string, detail: string\): void \{[\s\S]*?\n\}/)?.[0]
  assert.ok(constants)
  assert.ok(sanitize)
  assert.ok(logEvent)
  const output = []
  const context = vm.createContext({
    console: { info: value => output.push(value) },
    homedir: () => 'C:\\Users\\Omo',
    Date,
  })
  const executable = [
    constants.replace(': LogEntry[]', ''),
    sanitize.replace(/text: string\): string/, 'text)'),
    logEvent
      .replace(/^export /, '')
      .replace(/const entry: LogEntry =/, 'const entry =')
      .replace(/level: LogLevel/, 'level')
      .replace(/event: string/, 'event')
      .replace(/detail: string/, 'detail')
      .replace(/\): void/, ')'),
    'logEvent(\'error\', \'client-render\', \'line\\napiKey=super-secret-value\\u0000\')',
  ].join('\n')
  vm.runInContext(executable, context)
  assert.equal(output.length, 1)
  assert.match(output[0], /^\[dsh-market\] \{/) 
  const entry = JSON.parse(output[0].slice('[dsh-market] '.length))
  assert.equal(entry.level, 'error')
  assert.equal(entry.event, 'client-render')
  assert.doesNotMatch(entry.detail, /super-secret-value/)
  assert.doesNotMatch(entry.detail, /[\u0000-\u001f\u007f]/)
  assert.match(entry.detail, /apiKey=\*\*\*/)
})
