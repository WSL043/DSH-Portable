import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const projectRoot = path.resolve(import.meta.dirname, '..')

async function buildFixture(root, { componentsOverrides = {}, requiredShellSchema = 1 } = {}) {
  const source = path.join(root, 'source')
  const archive = path.join(root, 'DSH-Portable-update-windows-x64.zip')
  await mkdir(path.join(source, 'app', 'node_modules', '@deepseek-ai', 'dsh', 'lib'), { recursive: true })
  await mkdir(path.join(source, 'licenses'), { recursive: true })
  const metadata = {
    schemaVersion: 1,
    kind: 'dsh-app',
    portableVersion: '0.1.0-rc.7-portable.1',
    dshVersion: '0.1.0-rc.7',
    dshCommit: 'b'.repeat(40),
  }
  await writeFile(path.join(source, 'component.json'), `${JSON.stringify(metadata)}\n`)
  await writeFile(path.join(source, 'app', 'package.json'), '{"name":"fixture"}\n')
  await writeFile(path.join(source, 'app', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'), 'fixture\n')
  await writeFile(path.join(source, 'licenses', 'COMPONENTS.json'), `${JSON.stringify({
    portableVersion: metadata.portableVersion,
    dshVersion: metadata.dshVersion,
    dshCommit: metadata.dshCommit,
    platform: 'windows-x64',
    nodeVersion: '24.19.0',
    updaterSchema: 1,
    shellSchema: requiredShellSchema,
    ...componentsOverrides,
  })}\n`)
  await writeFile(path.join(source, 'licenses', 'DeepSeek-Harness-LICENSE.txt'), 'license\n')
  await writeFile(path.join(source, 'licenses', 'DeepSeek-Harness-THIRD_PARTY_NOTICES.md'), 'notices\n')
  await writeFile(path.join(source, 'licenses', 'pnpm-LICENSE.txt'), 'pnpm license\n')
  if (process.platform === 'win32') {
    await execFileAsync('tar.exe', ['-a', '-c', '-f', archive, '-C', source, '.'])
  } else if (process.platform === 'darwin') {
    await execFileAsync('ditto', ['-c', '-k', '--norsrc', source, archive])
  } else {
    await execFileAsync('zip', ['-q', '-r', archive, '.'], { cwd: source })
  }
  const bytes = await readFile(archive)
  const manifest = path.join(root, 'portable-update-windows-x64.json')
  await writeFile(manifest, `${JSON.stringify({
    schemaVersion: 1,
    portableVersion: metadata.portableVersion,
    platform: 'windows-x64',
    minimumUpdaterSchema: 1,
    requiredShellSchema,
    component: {
      kind: metadata.kind,
      dshVersion: metadata.dshVersion,
      dshCommit: metadata.dshCommit,
      requiredNodeVersion: '24.19.0',
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      urls: [`https://example.invalid/${path.basename(archive)}`],
    },
  })}\n`)
  return { archive, manifest }
}

test('release update verifier proves the exact component archive matches its manifest', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-update-artifact-'))
  try {
    const fixture = await buildFixture(root)
    const result = await execFileAsync(process.execPath, [
      path.join(projectRoot, 'scripts', 'verify-update-artifact.mjs'),
      fixture.manifest,
      fixture.archive,
    ])
    const report = JSON.parse(result.stdout)
    assert.equal(report.status, 'verified')
    assert.equal(report.dshVersion, '0.1.0-rc.7')

    const manifest = JSON.parse(await readFile(fixture.manifest, 'utf8'))
    manifest.component.sha256 = '0'.repeat(64)
    await writeFile(fixture.manifest, `${JSON.stringify(manifest)}\n`)
    await assert.rejects(execFileAsync(process.execPath, [
      path.join(projectRoot, 'scripts', 'verify-update-artifact.mjs'),
      fixture.manifest,
      fixture.archive,
    ]), /digest mismatch/i)

    const mismatched = await buildFixture(path.join(root, 'mismatched'), {
      componentsOverrides: { nodeVersion: '25.0.0' },
    })
    await assert.rejects(execFileAsync(process.execPath, [
      path.join(projectRoot, 'scripts', 'verify-update-artifact.mjs'),
      mismatched.manifest,
      mismatched.archive,
    ]), /metadata/i)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('release update verifier accepts a newer positive shell compatibility boundary', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-update-shell-schema-'))
  try {
    const fixture = await buildFixture(root, { requiredShellSchema: 2 })
    const result = await execFileAsync(process.execPath, [
      path.join(projectRoot, 'scripts', 'verify-update-artifact.mjs'),
      fixture.manifest,
      fixture.archive,
    ])
    assert.equal(JSON.parse(result.stdout).status, 'verified')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
