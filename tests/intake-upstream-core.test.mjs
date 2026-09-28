import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createIntakeReport,
  HISTORICAL_VALIDATION_BLOBS,
} from '../scripts/intake-upstream-core.mjs'
import {
  descriptorV2PatchIdentity,
  descriptorV2PatchIdentityFor,
} from '../scripts/patch-historical-descriptor.mjs'

const VERSION = '0.2.0-rc.1'
const COMMIT = '4878cdabd87d4041bdaff61d04c966883b9fd07a'
const INTEGRITY = 'sha512-F6hKNVoGgBDIzSiyRaIlobq4UD6cwxUjh+nwXqcDmufDh87TE1izsYzs8L5cZNpF2JmPnFM1mXRNnRJ0cs43ng=='
const NOTICES = '7f1b13082b40882731368cb2f62f254f4c1e257ff27fe22773532e912722bdf6'
const FAMILIES = { dsh: 318, vendor: 9, landlock: 0 }

const refreshAnchor = '"aria-label": t("refresh"),\n\t\t\t\t\t\t\t\t\t"aria-busy": refreshing,\n\t\t\t\t\t\t\t\t\tdisabled: !loaded || refreshing,\n\t\t\t\t\t\t\t\t\tonClick: props.refresh,'

function pluginManagerFixture(refreshAction = refreshAnchor) {
  let source = '"plugins.bundle.config": { kind: "keyed" };\nclassName: PluginManagerPage_module_css_default.toolbar,\n\t\t\t\t\t\t\tchildren: [originalAction]'
  source += '\nfunction PackageCard({ pkg, t, busy, highlighted, onOpen, onSetEnabled }) { return jsx("li", { children: (0, react_jsx_runtime.jsx)(CardHead, { tags: jsxs(Fragment, { children: [beta ? null : null] }), end: (0, react_jsx_runtime.jsx)(EnableSwitch, {\n\t\t\t\t\t})\n\t\t\t\t}) }); }\nfunction ItemCard() {}\nconst packageCard = (pkg) => (0, react_jsx_runtime.jsx)(PackageCard, {});'
  source += `\n${refreshAction}`
  return source
}

function goodFixture(overrides = {}) {
  const dsh = {
    version: VERSION,
    tag: `dsh-v${VERSION}`,
    reviewedCommit: COMMIT,
    integrity: INTEGRITY,
    noticesSha256: NOTICES,
    packedFamilies: FAMILIES,
  }
  return {
    version: VERSION,
    lock: { schemaVersion: 1, dsh: { ...dsh } },
    tagCommit: COMMIT,
    npmIntegrity: INTEGRITY,
    noticesSha256: NOTICES,
    packedFamilies: { ...FAMILIES },
    history: {
      validationBlobs: { ...HISTORICAL_VALIDATION_BLOBS },
      inputSha256: descriptorV2PatchIdentity.sourceSha256,
      versionIdentity: descriptorV2PatchIdentityFor(VERSION),
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
