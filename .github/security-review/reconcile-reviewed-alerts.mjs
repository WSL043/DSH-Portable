import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

export function expandIds(value) {
  if (Array.isArray(value)) return value
  return value.split(',').flatMap(part => {
    if (!/^\d+(?:-\d+)?$/.test(part)) throw new Error('Invalid explicit alert range')
    const [first, last = first] = part.split('-').map(Number)
    if (first < 1 || last < first || last - first > 1000) throw new Error('Invalid alert range')
    return Array.from({ length: last - first + 1 }, (_, i) => first + i)
  })
}
function location(value) {
  const v = value.location ?? value, p = v.physicalLocation ?? {}, r = p.region ?? {}
  return { file: p.artifactLocation?.uri ?? null, line: r.startLine ?? null,
    column: r.startColumn ?? null, endLine: r.endLine ?? null, endColumn: r.endColumn ?? null,
    text: v.message?.text ?? '' }
}
export function normalizeSarif(sarif) {
  return sarif.runs.flatMap(run => (run.results ?? []).map(r => ({
    id: r.properties?.['github/alertNumber'] ?? null, rule: r.ruleId,
    locations: (r.locations ?? []).map(location),
    flows: (r.codeFlows ?? []).flatMap(cf => (cf.threadFlows ?? []).map(tf => (tf.locations ?? []).map(location))),
    related: (r.relatedLocations ?? []).map(location),
  }))).sort((a, b) => a.id - b.id)
}
export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export function validateManifest(manifest) {
  assert.equal(manifest.repository, 'WSL043/DSH-Portable')
  assert.equal(manifest.sourceCommit, '11d2e3cb4459f51918de0217167b845489a72ab7')
  const ids = manifest.cases.flatMap(c => expandIds(c.ids))
  assert.equal(ids.length, 874)
  assert.equal(new Set(ids).size, 874)
  assert.ok(manifest.cases.every(c => ['false positive', 'open'].includes(c.disposition) && c.reason.length > 50))
  return new Map(manifest.cases.flatMap(c => expandIds(c.ids).map(id => [id, c])))
}
export function matchesSnapshot(alert, record, commit) {
  const i = alert.most_recent_instance, s = record.locations[0]
  return alert.number === record.id && alert.rule.id === record.rule && i?.ref === 'refs/heads/main'
    && i.commit_sha === commit && i.location.path === s.file && i.location.start_line === s.line
    && i.location.end_line === s.endLine && i.location.start_column === s.column
    && i.location.end_column === s.endColumn
}
export function dismissalComment(record, decision) {
  const unique = [...new Set(record.flows.filter(f => f.length).map(f => `${f[0].file}:${f[0].line} (${f[0].text})`))]
  const sink = record.locations[0]
  return `Review 2026-09-19; ${record.rule}; #${record.id}. Source: ${unique.join('; ') || 'see SARIF related locations'}. Sink: ${sink.file}:${sink.line}. ${decision.reason} Evidence: PR #139; pinned analysis at 11d2e3cb4459f51918de0217167b845489a72ab7. No global query/path exclusion.`
}

async function main() {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const filename = args.find(a => !a.startsWith('--')) ?? '.github/security-review/review-manifest.json'
  const manifest = JSON.parse(await readFile(filename, 'utf8'))
  const decisions = validateManifest(manifest)
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
  if (!token) throw new Error('Authenticated GitHub token is required; never print it')
  const root = 'https://api.github.com/repos/WSL043/DSH-Portable'
  const reportDir = process.env.REVIEW_OUTPUT_DIR || 'build/security-review'
  await mkdir(reportDir, { recursive: true })
  const receipt = { repository: manifest.repository, sourceCommit: manifest.sourceCommit,
    apply, startedAt: new Date().toISOString(), decisions: [], updated: [], skipped: [], errors: [], complete: false }
  const save = () => writeFile(path.join(reportDir, 'receipt.json'), JSON.stringify(receipt, null, 2))
  async function api(endpoint, options = {}) {
    if (!endpoint.startsWith('/')) throw new Error('Invalid repository endpoint')
    const response = await fetch(root + endpoint, {
      method: options.body ? 'PATCH' : 'GET', redirect: 'error', signal: AbortSignal.timeout(60000),
      headers: { Authorization: `Bearer ${token}`, Accept: options.accept || 'application/vnd.github+json',
        'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    })
    if (!response.ok) {
      // Do not work around an authorization or rate-limit response.
      throw new Error(`GitHub ${response.status} at ${endpoint}; retry-after=${response.headers.get('retry-after') || ''}; remaining=${response.headers.get('x-ratelimit-remaining') || ''}`)
    }
    return response.json()
  }
  const assertMain = async () => assert.equal((await api('/branches/main')).commit.sha, manifest.sourceCommit, 'Default branch changed; review a new snapshot before writing')
  const listOpen = async () => {
    const all = []
    for (let page = 1; page <= 100; page++) {
      const rows = await api(`/code-scanning/alerts?state=open&per_page=100&page=${page}`)
      assert.ok(Array.isArray(rows))
      all.push(...rows)
      if (rows.length < 100) return all
    }
    throw new Error('Unexpected pagination bound')
  }
  try {
    await assertMain()
    const records = new Map()
    for (const pin of manifest.analyses) {
      const sarif = await api(`/code-scanning/analyses/${pin.id}`, { accept: 'application/sarif+json' })
      const normalized = normalizeSarif(sarif)
      assert.equal(normalized.length, pin.results)
      assert.equal(digest(normalized), pin.sha256, `Analysis ${pin.id} differs from the reviewed export`)
      for (const r of normalized) records.set(r.id, r)
    }
    const current = new Map((await listOpen()).map(a => [a.number, a]))
    receipt.openBefore = current.size
    const queue = []
    for (const [id, decision] of [...decisions].sort((a, b) => a[0] - b[0])) {
      const record = records.get(id)
      assert.ok(record, `Missing SARIF result #${id}`)
      receipt.decisions.push({ id, rule: record.rule, sink: record.locations[0], case: decision.key,
        disposition: decision.disposition, comment: dismissalComment(record, decision) })
      if (decision.disposition === 'open') continue
      const alert = current.get(id)
      if (!alert) { receipt.skipped.push({ id, reason: 'not open; existing state untouched' }); continue }
      assert.ok(matchesSnapshot(alert, record, manifest.sourceCommit), `Alert #${id} changed; no write allowed`)
      queue.push({ id, record, decision })
    }
    receipt.planned = queue.length
    await save()
    console.log(`Verified ${decisions.size} explicit IDs; ${queue.length} reviewed dispositions; ${[...decisions.values()].filter(c => c.disposition === 'open').length} held for code/scan verification`)
    if (apply) {
      for (const [index, item] of queue.entries()) {
        if (index % 50 === 0) await assertMain()
        const result = await api(`/code-scanning/alerts/${item.id}`, { body: {
          state: 'dismissed', dismissed_reason: 'false positive',
          dismissed_comment: dismissalComment(item.record, item.decision), create_request: false,
        } })
        assert.equal(result.number, item.id)
        assert.equal(result.state, 'dismissed')
        receipt.updated.push({ id: result.number, state: result.state, reason: result.dismissed_reason, at: result.dismissed_at })
        await save()
        if ((index + 1) % 25 === 0) console.log(`Confirmed ${index + 1}/${queue.length} dispositions`)
        await new Promise(resolve => setTimeout(resolve, 1100))
      }
    }
    receipt.openAfter = (await listOpen()).map(a => ({ id: a.number, rule: a.rule.id, location: a.most_recent_instance.location }))
    receipt.complete = true
  } catch (error) {
    receipt.errors.push(String(error?.message || error))
    process.exitCode = 1
  } finally {
    receipt.finishedAt = new Date().toISOString()
    await save()
    console.log(JSON.stringify({ complete: receipt.complete, apply, planned: receipt.planned,
      confirmedUpdates: receipt.updated.length, remainingOpen: receipt.openAfter?.length, errors: receipt.errors }))
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main()
