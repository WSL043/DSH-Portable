import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { platformUpdateKey } from '../launcher/update-core.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (name) => readFile(path.join(root, name), 'utf8')

test('Linux runtimes are pinned for both supported CPU families', async () => {
  const lock = JSON.parse(await read('upstream.lock.json'))
  assert.deepEqual(lock.node.runtimes['linux-x64'], {
    archive: 'node-v24.19.0-linux-x64.tar.xz',
    sha256: '14b342e71204f811bde6153be8e04b62aef63c236fef92b55f9c83154b409647',
  })
  assert.deepEqual(lock.node.runtimes['linux-arm64'], {
    archive: 'node-v24.19.0-linux-arm64.tar.xz',
    sha256: '01443c1e1a29e531ccad5a46fefa6df490d2189c49f7955904aecdbb0fe86fdc',
  })
})

test('Linux uses architecture-specific component update channels', () => {
  assert.equal(platformUpdateKey('linux', 'x64'), 'linux-x64')
  assert.equal(platformUpdateKey('linux', 'arm64'), 'linux-arm64')
  assert.throws(() => platformUpdateKey('linux', 'ia32'), /unsupported/i)
})

test('Linux shell is a native Tauri window over the official local DSH server', async () => {
  const [cargo, cargoLock, source, config, build, cli, workflow] = await Promise.all([
    read('launcher/linux/Cargo.toml'),
    read('launcher/linux/Cargo.lock'),
    read('launcher/linux/src/main.rs'),
    read('launcher/linux/tauri.conf.json'),
    read('scripts/build-linux.sh'),
    read('launcher/portable-cli.mjs'),
    read('.github/workflows/ci.yml'),
  ])
  assert.match(cargo, /tauri\s*=\s*\{[^\n]+version\s*=\s*"=2\./)
  assert.match(cargo, /rust-version\s*=\s*"1\.88"/)
  assert.match(cargoLock, /^version = 4$/m)
  assert.match(workflow, /dtolnay\/rust-toolchain@1\.88\.0/)
  assert.match(source, /portable-cli\.mjs/)
  assert.match(source, /--no-browser/)
  assert.match(source, /navigate\(/)
  assert.match(source, /check-update/)
  assert.match(source, /defer-update/)
  assert.match(source, /DSH_PORTABLE_STATE_ROOT/)
  assert.doesNotMatch(source, /xdg-open|gio\s+open|Command::new\("(?:firefox|chromium|google-chrome)"/i)
  assert.match(config, /"productName"\s*:\s*"DeepSeek-Herness"/)
  assert.match(config, /"targets"\s*:\s*\[\s*"appimage"/)
  assert.match(build, /DSH-Portable-linux-\$ARCH\.tar\.gz/)
  assert.match(build, /DeepSeek-Herness-linux-\$ARCH\.AppImage/)
  assert.match(build, /rustc --version[\s\S]+rustc 1\.88\.0/)
  assert.match(build, /cargo metadata --locked/)
  assert.match(build, /npm exec -- tauri build --bundles appimage/)
  assert.match(cli, /\['win32',\s*'darwin',\s*'linux'\]/)
})

test('Linux packaging and real product smokes run independently on x64 and arm64', async () => {
  const [workflow, appImagePluginSmoke] = await Promise.all([
    read('.github/workflows/ci.yml'),
    read('scripts/smoke-linux-appimage-plugins.sh'),
  ])
  for (const runner of ['ubuntu-22.04', 'ubuntu-22.04-arm']) assert.match(workflow, new RegExp(runner.replaceAll('.', '\\.')))
  assert.match(workflow, /^  linux-build:/m)
  assert.match(workflow, /^  linux-portable-smoke:/m)
  assert.match(workflow, /^  linux-plugin-smoke:/m)
  assert.match(workflow, /^  linux-desktop-host:/m)
  assert.match(workflow, /build-linux\.sh/)
  assert.match(workflow, /smoke-linux-plugins\.sh/)
  assert.match(workflow, /smoke-linux-appimage-plugins\.sh/)
  assert.match(workflow, /smoke-linux-desktop-host\.sh/)
  assert.match(workflow, /xvfb-run/)
  assert.match(appImagePluginSmoke, /APPIMAGE_EXTRACT_AND_RUN=1/)
  assert.match(appImagePluginSmoke, /plugin --profile "\$PROFILE" add/)
  assert.match(appImagePluginSmoke, /--dump-config/)
  assert.match(appImagePluginSmoke, /DSH-Portable-data/)
  assert.match(appImagePluginSmoke, /mv "\$ROOT" "\$MOVED"/)
})

test('release staging exposes two obvious Linux choices per architecture', async () => {
  const staging = await read('scripts/stage-release-assets.mjs')
  for (const arch of ['x64', 'arm64']) {
    assert.match(staging, new RegExp(`DSH-Portable-linux-${arch}\\.tar\\.gz`))
    assert.match(staging, new RegExp(`DeepSeek-Herness-linux-${arch}\\.AppImage`))
    assert.match(staging, new RegExp(`DSH-Portable-update-linux-${arch}\\.zip`))
    assert.match(staging, new RegExp(`portable-update-linux-${arch}\\.json`))
  }
})

test('Chinese-first product docs explain Linux launch, portable data, plugins, and CPU choice', async () => {
  const [chinese, english, bundled, notes] = await Promise.all([
    read('README.md'),
    read('README.en.md'),
    read('templates/USER-README.txt'),
    read('templates/RELEASE-NOTES.md'),
  ])
  for (const source of [chinese, english, notes]) {
    assert.match(source, /DeepSeek-Herness-linux-x64\.AppImage/)
    assert.match(source, /DeepSeek-Herness-linux-arm64\.AppImage/)
    assert.match(source, /DSH-Portable-linux-x64\.tar\.gz/)
    assert.match(source, /DSH-Portable-linux-arm64\.tar\.gz/)
  }
  assert.match(chinese, /Linux[\s\S]+AppImage[\s\S]+DSH-Portable-data/)
  assert.match(english, /Linux[\s\S]+AppImage[\s\S]+DSH-Portable-data/)
  assert.match(bundled, /Linux[\s\S]+\.\/dsh plugin/)
  assert.match(chinese, /Windows%20%7C%20macOS%20%7C%20Linux/)
})

test('Linux native loading surface follows Chinese or English without an external page', async () => {
  const loading = await read('launcher/linux/ui/index.html')
  assert.match(loading, /navigator\.language/)
  assert.match(loading, /正在启动 DeepSeek Harness/)
  assert.match(loading, /Starting DeepSeek Harness/)
  assert.match(loading, /prefers-color-scheme/)
  assert.match(loading, /prefers-reduced-motion/)
  assert.doesNotMatch(loading, /https?:\/\//)
})
