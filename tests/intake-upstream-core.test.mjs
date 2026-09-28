import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  createIntakeReport,
  formatIntakeMarkdown,
  formatIntakeReport,
  HISTORICAL_VALIDATION_BLOBS,
  intakeExitCode,
  parseIntakeArgs,
  recordHistoricalDescriptorVersion,
  writeIntakeMarkdown,
} from '../scripts/intake-upstream-core.mjs'
import {
  descriptorV2PatchIdentity,
  readHistoricalDescriptorVersions,
} from '../scripts/patch-historical-descriptor.mjs'

const VERSION = '0.2.0-rc.1'
const NEW_VERSION = '0.2.1-rc.3'
const COMMIT = '4878cdabd87d4041bdaff61d04c966883b9fd07a'
const INTEGRITY = 'sha512-F6hKNVoGgBDIzSiyRaIlobq4UD6cwxUjh+nwXqcDmufDh87TE1izsYzs8L5cZNpF2JmPnFM1mXRNnRJ0cs43ng=='
const NOTICES = '7f1b13082b40882731368cb2f62f254f4c1e257ff27fe22773532e912722bdf6'
const FAMILIES = { dsh: 318, vendor: 9, landlock: 0 }
const TEST_TEMP_ROOT = fileURLToPath(new URL('../build/orch-080/T14/test-fixtures/', import.meta.url))

async function makeTestTemp(prefix) {
  await mkdir(TEST_TEMP_ROOT, { recursive: true })
  return mkdtemp(path.join(TEST_TEMP_ROOT, prefix))
}

const refreshAnchor = '"aria-label": t("refresh"),\n\t\t\t\t\t\t\t\t\t"aria-busy": refreshing,\n\t\t\t\t\t\t\t\t\tdisabled: !loaded || refreshing,\n\t\t\t\t\t\t\t\t\tonClick: props.refresh,'

function pluginManagerFixture(refreshAction = refreshAnchor) {
  let source = '"plugins.bundle.config": { kind: "keyed" };\nclassName: PluginManagerPage_module_css_default.toolbar,\n\t\t\t\t\t\t\tchildren: [originalAction]'
  source += '\nfunction PackageCard({ pkg, t, busy, highlighted, onOpen, onSetEnabled }) { return jsx("li", { children: (0, react_jsx_runtime.jsx)(CardHead, { tags: jsxs(Fragment, { children: [beta ? null : null] }), end: (0, react_jsx_runtime.jsx)(EnableSwitch, {\n\t\t\t\t\t})\n\t\t\t\t}) }); }\nfunction ItemCard() {}\nconst packageCard = (pkg) => (0, react_jsx_runtime.jsx)(PackageCard, {});'
  source += `\n${refreshAction}`
  return source
}

function goodFixture(overrides = {}) {
  const version = overrides.version ?? VERSION
  const dsh = {
    version,
    tag: `dsh-v${version}`,
    reviewedCommit: COMMIT,
    integrity: INTEGRITY,
    noticesSha256: NOTICES,
    packedFamilies: FAMILIES,
  }
  return {
    version,
    lock: { schemaVersion: 1, dsh: { ...dsh } },
    tagCommit: COMMIT,
    npmIntegrity: INTEGRITY,
    noticesSha256: NOTICES,
    packedFamilies: { ...FAMILIES },
    history: {
      validationBlobs: { ...HISTORICAL_VALIDATION_BLOBS },
      inputSha256: descriptorV2PatchIdentity.sourceSha256,
    },
    pluginManagerBundle: {
      source: pluginManagerFixture(),
      sha256: 'a'.repeat(64),
      packageVersion: VERSION,
    },
    ...overrides,
  }
}

test('matching 0.2.0-rc.1 metadata and anchors pass with zero lock differences', () => {
  const report = createIntakeReport(goodFixture())
  assert.equal(report.passed, true)
  assert.deepEqual(report.checks.map(check => check.status), ['PASS', 'PASS', 'PASS', 'PASS', 'PASS'])
  assert.match(report.checks[1].evidence, /zero differences/)
  assert.equal(report.candidateFields.reviewedCommit, COMMIT)
})

test('changed historical input digest fails and requires human patch review', () => {
  const input = goodFixture()
  input.history.inputSha256 = '0'.repeat(64)
  const report = createIntakeReport(input)
  assert.equal(report.passed, false)
  assert.equal(report.checks[2].status, 'FAIL')
  assert.match(report.checks[2].evidence, /needs human patch review/)
  assert.match(report.checks[2].evidence, /automatic identity relaxation is forbidden/)
  assert.equal(report.verdict, 'needs-review:3')
  assert.ok(formatIntakeReport(report).endsWith('VERDICT=needs-review:3\n'))
  assert.equal(intakeExitCode(report), 1)
})

test('an exact unrecorded version with matching validation blobs and bundle digest is same-shape', () => {
  const report = createIntakeReport(goodFixture({ version: NEW_VERSION }))
  assert.equal(report.passed, true)
  assert.equal(report.sameShape, true)
  assert.equal(report.verdict, 'same-shape')
  assert.equal(intakeExitCode(report), 0)
  assert.ok(formatIntakeReport(report).endsWith('VERDICT=same-shape\n'))
  assert.match(formatIntakeMarkdown(report), /Intake verdict: `same-shape`/)
  assert.match(formatIntakeMarkdown(report), /稳定线采用前仍需人工接入记录/)
})

test('shape verdict names the first failing item among checks 3, 4, and 5', () => {
  const cases = [
    ['3', { history: { ...goodFixture().history, inputSha256: '0'.repeat(64) } }],
    ['4', { lock: { ...goodFixture().lock, dsh: { ...goodFixture().lock.dsh, packedFamilies: null } } }],
    ['5', { pluginManagerBundle: { source: 'no refresh action anchors here', packageVersion: VERSION } }],
  ]
  for (const [id, overrides] of cases) {
    const report = createIntakeReport(goodFixture(overrides))
    assert.equal(report.checks[Number(id) - 1].status, 'FAIL')
    assert.equal(report.verdict, `needs-review:${id}`)
    assert.ok(formatIntakeReport(report).endsWith(`VERDICT=needs-review:${id}\n`))
  }
})

test('--record-shape appends a same-shape version once and is byte-idempotent', async () => {
  const root = await makeTestTemp('record-')
  const filePath = path.join(root, 'historical-descriptor-versions.json')
  try {
    const before = readHistoricalDescriptorVersions()
    await writeFile(filePath, `${JSON.stringify(before, null, 2)}\n`)
    const report = createIntakeReport(goodFixture({ version: NEW_VERSION }))
    assert.deepEqual(await recordHistoricalDescriptorVersion(NEW_VERSION, report, { filePath }), { changed: true, skipped: false })
    assert.deepEqual(readHistoricalDescriptorVersions(filePath), [...before, NEW_VERSION])
    const recorded = await readFile(filePath, 'utf8')
    assert.deepEqual(await recordHistoricalDescriptorVersion(NEW_VERSION, report, { filePath }), { changed: false, skipped: false })
    assert.equal(await readFile(filePath, 'utf8'), recorded)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('--record-shape does not write a different-shape candidate', async () => {
  const root = await makeTestTemp('reject-')
  const filePath = path.join(root, 'historical-descriptor-versions.json')
  try {
    await writeFile(filePath, `${JSON.stringify(readHistoricalDescriptorVersions(), null, 2)}\n`)
    const before = await readFile(filePath, 'utf8')
    const cases = [
      ['3', { history: { validationBlobs: { ...HISTORICAL_VALIDATION_BLOBS }, inputSha256: '0'.repeat(64) } }],
      ['4', { lock: { ...goodFixture().lock, dsh: { ...goodFixture().lock.dsh, packedFamilies: null } } }],
      ['5', { pluginManagerBundle: { source: 'no refresh action anchors here', packageVersion: NEW_VERSION } }],
    ]
    for (const [id, overrides] of cases) {
      const report = createIntakeReport(goodFixture({ version: NEW_VERSION, ...overrides }))
      const result = await recordHistoricalDescriptorVersion(NEW_VERSION, report, { filePath })
      assert.equal(report.verdict, `needs-review:${id}`)
      assert.equal(intakeExitCode(report), 1)
      assert.equal(result.changed, false)
      assert.equal(result.skipped, true)
      assert.equal(await readFile(filePath, 'utf8'), before)
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('--markdown writes a reusable report file and CLI arguments accept the preview lock', async () => {
  const root = await makeTestTemp('markdown-')
  try {
    const report = createIntakeReport(goodFixture({ version: NEW_VERSION }))
    const filePath = path.join(root, 'intake-report.md')
    await writeIntakeMarkdown(filePath, report, { lockName: 'upstream.preview.lock.json', recordShapeRequested: true })
    const markdown = await readFile(filePath, 'utf8')
    assert.match(markdown, /Compared lock: `upstream\.preview\.lock\.json`/)
    assert.ok(markdown.endsWith('VERDICT=same-shape\n'))
    assert.deepEqual(parseIntakeArgs([
      NEW_VERSION, '--lock', 'upstream.preview.lock.json', '--record-shape', '--markdown', 'intake-report.md',
    ]), {
      version: NEW_VERSION,
      lockPath: 'upstream.preview.lock.json',
      markdownPath: 'intake-report.md',
      writeRequested: false,
      recordShapeRequested: true,
    })
    assert.deepEqual(parseIntakeArgs([VERSION]), {
      version: VERSION,
      lockPath: 'upstream.lock.json',
      markdownPath: null,
      writeRequested: false,
      recordShapeRequested: false,
    })
    assert.equal(parseIntakeArgs([VERSION, '--record-shape', '--write']), null)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Plugin Manager zero and multiple refresh anchors fail through the existing patch checker', async t => {
  const zero = pluginManagerFixture().replace(refreshAnchor, '"aria-label": t("reload"),')
  const multiple = pluginManagerFixture(`${refreshAnchor}\n${refreshAnchor}`)
  for (const [name, source, expected] of [
    ['zero matches', zero, /found 0/],
    ['multiple matches', multiple, /found 2/],
  ]) {
    await t.test(name, () => {
      const fixture = goodFixture({ pluginManagerBundle: { source, packageVersion: VERSION } })
      const report = createIntakeReport(fixture)
      assert.equal(report.passed, false)
      assert.equal(report.checks[4].status, 'FAIL')
      assert.match(report.checks[4].evidence, expected)
    })
  }
})
