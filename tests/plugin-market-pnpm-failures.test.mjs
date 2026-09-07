import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { classifyPnpmFailure } from '../app/vendor/dsh-portable-plugin-market/src/pnpm-compat.ts'

test('the shipped market bundle includes the new install failure diagnostics', async () => {
  const bundle = await readFile(new URL('../app/vendor/dsh-portable-plugin-market/lib/index.js', import.meta.url), 'utf8')
  for (const code of ['ERR_PNPM_PREPARE_PACKAGE', 'ERR_PNPM_TARBALL_URL_MISMATCH', 'git-prepare-failed', 'tarball-url-mismatch']) {
    assert.ok(bundle.includes(code), `packaged market is missing ${code}; rebuild its server bundle`)
  }
})

test('git prepare failures preserve the named package without guessing an inner cause', () => {
  const message = 'ERR_PNPM_PREPARE_PACKAGE: Failed to prepare git-hosted package fetched from "https://codeload.github.com/o/r/tar.gz/abc": @scope/plugin@1.0.0 pnpm-install: pnpm install Exit status 1'
  for (const output of [message, JSON.stringify({ err: { code: 'ERR_PNPM_PREPARE_PACKAGE', message } })]) {
    const failure = classifyPnpmFailure(output)
    assert.equal(failure?.code, 'git-prepare-failed')
    assert.equal(failure.recoverable, false)
    assert.equal(failure.pkg, '@scope/plugin')
  }
  assert.equal(classifyPnpmFailure('ERR_PNPM_PREPARE_PACKAGE: unknown format')?.pkg, undefined)
})

test('explicit tarball mismatch takes precedence over its prepare wrapper and decodes package names', () => {
  const one = '@scope/plugin@1.0.0 has a tarball URL (https://registry.example/a.tgz) that does not match the registry metadata'
  const message = `ERR_PNPM_PREPARE_PACKAGE ERR_PNPM_TARBALL_URL_MISMATCH\n${one}`
  for (const output of [message, JSON.stringify({ err: { code: 'ERR_PNPM_TARBALL_URL_MISMATCH', message } })]) {
    const failure = classifyPnpmFailure(output)
    assert.equal(failure?.code, 'tarball-url-mismatch')
    assert.equal(failure.recoverable, false)
    assert.equal(failure.pkg, '@scope/plugin')
  }
  const multiple = classifyPnpmFailure(`${message}\nother@2.0.0 has a tarball URL (https://registry.example/b.tgz)`)
  assert.equal(multiple.pkg, undefined)
  assert.match(multiple.message, /@scope\/plugin/)
  assert.match(multiple.message, /other/)
})
import { pnpmNeverStarted } from '../app/vendor/dsh-portable-plugin-market/src/dsh-cli.ts'

const failed = (overrides = {}) => ({
  exitCode: 1,
  timedOut: false,
  stdout: '',
  stderr: '',
  cancelled: false,
  ...overrides,
})

test('classifies a present pnpm that cmd.exe could not launch with exit 9009', () => {
  const output = "'\"\"' ����\ndsh: pnpm failed in profile directory"
  const failure = classifyPnpmFailure(output, 9009)

  assert.equal(failure?.code, 'pnpm-unusable')
  assert.equal(failure?.recoverable, false)
  assert.equal(failure?.replaceOutput, true)
  assert.match(failure?.message ?? '', /9009/)
  assert.match(failure?.message ?? '', /Portable.*DSH.*终端/s)
  assert.match(failure?.message ?? '', /检查并修复/)
  assert.doesNotMatch(failure?.message ?? '', /dsh web/)
  assert.doesNotMatch(failure?.message ?? '', /global pnpm/)
})

test('classifies cmd.exe wording without requiring an exit code', () => {
  assert.equal(
    classifyPnpmFailure("'pnpm' is not recognized as an internal or external command, operable program or batch file.")?.code,
    'pnpm-unusable',
  )
  assert.equal(classifyPnpmFailure("'pnpm' 不是内部或外部命令。")?.code, 'pnpm-unusable')
})

test('classifies spawn EACCES and ENOENT with cause-specific advice', () => {
  const denied = classifyPnpmFailure(
    "Error: spawnSync pnpm EACCES\n  code: 'EACCES',\n  syscall: 'spawnSync pnpm',",
    1,
  )
  assert.equal(denied?.code, 'pnpm-unusable')
  assert.equal(denied?.replaceOutput, true)
  assert.match(denied?.message ?? '', /noexec/)
  assert.match(denied?.message ?? '', /Portable.*DSH.*终端/s)
  assert.doesNotMatch(denied?.message ?? '', /9009/)

  const gone = classifyPnpmFailure(
    "Error: spawnSync pnpm ENOENT { code: 'ENOENT', syscall: 'spawnSync pnpm' }",
    1,
  )
  assert.equal(gone?.code, 'pnpm-unusable')
  assert.match(gone?.message ?? '', /ENOENT/)
  assert.doesNotMatch(gone?.message ?? '', /chmod \+x/)
})

test('does not let the launcher classification hide a pnpm diagnostic', () => {
  assert.equal(
    classifyPnpmFailure('ERR_PNPM_ADDING_TO_ROOT\nRunning this command will add the dependency to the workspace root', 9009)?.code,
    'adding-to-root',
  )
  assert.equal(classifyPnpmFailure('ordinary failure', 1), null)
})

test('classifies a missing local file or tgz dependency and names its path', () => {
  for (const prefix of [' ENOENT  ', '[ENOENT] ']) {
    const path = '/home/u/downloads/dsh-sandbox-escalation-fix-0.1.2-alpha1.tgz'
    const output = `${prefix}ENOENT: no such file or directory, open '${path}'\n\nThis error happened while installing a direct dependency of /home/u/.dsh/profiles/web\n`
    const failure = classifyPnpmFailure(output, 254)
    assert.equal(failure?.code, 'missing-local-dependency')
    assert.equal(failure?.recoverable, false)
    assert.match(failure?.message ?? '', /dsh-sandbox-escalation-fix-0\.1\.2-alpha1\.tgz/)
    assert.match(failure?.message ?? '', /blocks every install and uninstall/)
    assert.match(failure?.message ?? '', /恢复.*原路径/s)
    assert.match(failure?.message ?? '', /备份 profile/s)
    assert.doesNotMatch(failure?.message ?? '', /删掉.*dependencies/s)
  }
})

test('does not misclassify an unrelated ENOENT as a dead profile dependency', () => {
  assert.equal(
    classifyPnpmFailure("ENOENT: no such file or directory, open '/tmp/build-output'", 1),
    null,
  )
})

test('does not call an unqualified spawn failure a pnpm launcher failure', () => {
  assert.equal(
    classifyPnpmFailure('Error: spawnSync pnpm failed with an unknown launcher error', 1),
    null,
  )
})

test('pnpmNeverStarted is true only for launcher failures', () => {
  assert.equal(pnpmNeverStarted(failed({ exitCode: 9009, stderr: "'\"\"' ����" })), true)
  assert.equal(pnpmNeverStarted(failed({ stderr: "Error: spawnSync pnpm EACCES\n  syscall: 'spawnSync pnpm'" })), true)
  assert.equal(pnpmNeverStarted(failed({ stderr: "Error: spawnSync pnpm ENOENT\n  syscall: 'spawnSync pnpm'" })), true)
  assert.equal(pnpmNeverStarted(failed({ stderr: 'ERR_PNPM_FETCH_404 GET https://registry.npmjs.org/ghost' })), false)
  assert.equal(pnpmNeverStarted(failed({ stderr: 'ordinary failure' })), false)
})
