import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { renderWingetManifests } from '../scripts/render-winget-manifests.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('WinGet submission material identifies the tested installer and its installed product', () => {
  const files = renderWingetManifests({
    version: '9.8.7',
    installerSha256: 'A'.repeat(64),
    releaseDate: '2026-08-22',
  })

  assert.deepEqual(Object.keys(files).sort(), [
    'WSL043.DSH-Portable.installer.yaml',
    'WSL043.DSH-Portable.locale.en-US.yaml',
    'WSL043.DSH-Portable.locale.zh-CN.yaml',
    'WSL043.DSH-Portable.yaml',
  ])

  const installer = files['WSL043.DSH-Portable.installer.yaml']
  assert.match(installer, /PackageIdentifier: WSL043\.DSH-Portable/)
  assert.match(installer, /PackageVersion: 9\.8\.7/)
  assert.match(installer, /InstallerType: inno/)
  assert.match(installer, /Scope: user/)
  assert.match(installer, /InstallerUrl: https:\/\/github\.com\/WSL043\/DSH-Portable\/releases\/download\/v9\.8\.7\/DeepSeek-Herness-Setup\.exe/)
  assert.match(installer, new RegExp(`InstallerSha256: ${'A'.repeat(64)}`))
  assert.match(installer, /ProductCode: '\{1F096C3A-7991-4E55-B0F9-68A50B24C5A8\}_is1'/)
  assert.match(installer, /AppsAndFeaturesEntries:[\s\S]+DisplayName: DeepSeek-Herness 9\.8\.7/)
  assert.match(installer, /ReleaseDate: 2026-08-22/)

  const english = files['WSL043.DSH-Portable.locale.en-US.yaml']
  const chinese = files['WSL043.DSH-Portable.locale.zh-CN.yaml']
  assert.match(english, /PackageName: DSH-Portable/)
  assert.match(english, /portable-first desktop distribution/i)
  assert.match(chinese, /PackageName: DSH-Portable/)
  assert.match(chinese, /便携优先/)
  assert.match(english, /not an official DeepSeek desktop app/i)
  assert.match(chinese, /并非 DeepSeek 官方桌面应用/)
})

test('WinGet material refuses mutable or malformed release inputs', () => {
  assert.throws(() => renderWingetManifests({
    version: '0.4.4-rc.1',
    installerSha256: 'A'.repeat(64),
    releaseDate: '2026-08-22',
  }), /stable semantic version/)
  assert.throws(() => renderWingetManifests({
    version: '0.4.4',
    installerSha256: 'not-a-hash',
    releaseDate: '2026-08-22',
  }), /SHA-256/)
})

test('stable publication prepares WinGet material without cluttering user downloads', async () => {
  const workflow = await readFile(path.join(root, '.github/workflows/publish.yml'), 'utf8')
  const generator = workflow.slice(
    workflow.indexOf('Generate a WinGet submission bundle'),
    workflow.indexOf('Publish curated user downloads'),
  )

  assert.match(generator, /steps\.version\.outputs\.channel == 'stable'/)
  assert.match(generator, /DeepSeek-Herness-Setup\.exe/)
  assert.match(generator, /render-winget-manifests\.mjs/)
  assert.match(generator, /winget-submission-/)
  assert.match(generator, /actions\/upload-artifact@v7/)
  assert.doesNotMatch(generator, /gh release upload/)
})
