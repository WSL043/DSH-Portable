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

test('Linux requires the rc8-aware native shell before installing the app component', async () => {
  const source = await read('scripts/build-linux.sh')
  assert.match(source, /"shellSchema": 5/)
  assert.match(source, /"requiredShellSchema": 5/)
})

test('Linux shell is a native Tauri window over the official local DSH server', async () => {
  const [cargo, cargoLock, source, config, build, cli, rootCli, pnpmCli, attributes, workflow] = await Promise.all([
    read('launcher/linux/Cargo.toml'),
    read('launcher/linux/Cargo.lock'),
    read('launcher/linux/src/main.rs'),
    read('launcher/linux/tauri.conf.json'),
    read('scripts/build-linux.sh'),
    read('launcher/portable-cli.mjs'),
    read('launcher/linux/dsh'),
    read('launcher/linux/pnpm'),
    read('.gitattributes'),
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
  assert.match(source, /ignore-update/)
  assert.match(source, /YesNoCancel/)
  const liveCheck = source.slice(source.indexOf('fn check_updates('), source.indexOf('fn stop_and_exit('))
  assert.doesNotMatch(liveCheck, /run_portable_cli\(&layout,\s*&\["update"/)
  assert.match(liveCheck, /install_update_at_next_start\s*=\s*true/)
  assert.match(liveCheck, /releaseUrl/)
  assert.doesNotMatch(liveCheck, /releases\/latest/)
  const startup = source.slice(source.indexOf('fn start_dsh('), source.indexOf('fn run_dsh_passthrough('))
  assert.match(startup, /apply_pending_update/)
  assert.ok(startup.indexOf('apply_pending_update') < startup.indexOf('["start", "--no-browser", "--json"]'))
  const pendingUpdate = source.slice(source.indexOf('fn apply_pending_update('), source.indexOf('fn start_dsh('))
  const pendingRunIndex = pendingUpdate.indexOf('run_portable_cli(layout, &["update"')
  const pendingClearIndex = pendingUpdate.indexOf('install_update_at_next_start = false')
  assert.ok(
    pendingRunIndex >= 0 && pendingClearIndex > pendingRunIndex,
    'a failed Linux update must remain scheduled for the following launch',
  )
  assert.match(source, /DSH_PORTABLE_STATE_ROOT/)
  assert.match(source, /direct_mode[\s\S]+env::var_os\("APPDIR"\)\.is_some\(\)[\s\S]+resolve_layout\(None\)/)
  assert.match(source, /fn copy_symlink[\s\S]+read_link[\s\S]+unix::fs::symlink/)
  assert.match(source, /file_type\.is_symlink\(\)[\s\S]+copy_symlink/)
  assert.doesNotMatch(source, /xdg-open|gio\s+open|Command::new\("(?:firefox|chromium|google-chrome)"/i)
  assert.match(config, /"productName"\s*:\s*"DeepSeek-Herness"/)
  assert.match(config, /"targets"\s*:\s*\[\s*"appimage"/)
  assert.match(build, /DSH-Portable-linux-\$ARCH\.tar\.gz/)
  assert.match(build, /DeepSeek-Herness-linux-\$ARCH\.AppImage/)
  assert.match(build, /rustc --version[\s\S]+rustc 1\.88\.0/)
  assert.match(build, /cargo metadata --locked/)
  assert.match(build, /command -v patchelf/)
  assert.match(build, /NO_STRIP=true npm exec -- tauri build --verbose --bundles appimage/)
  assert.match(workflow, /libwebkit2gtk-4\.1-dev[\s\\]+patchelf/)
  assert.match(workflow, /libayatana-appindicator3-1[\s\\]+libwebkit2gtk-4\.1-0/)
  assert.match(rootCli, /ROOT=\$\(CDPATH= cd -- "\$\(dirname -- "\$0"\)" && pwd\)/)
  assert.doesNotMatch(rootCli, /dirname[^\n]+\.\.\/\.\./)
  assert.match(pnpmCli, /app\/node_modules\/pnpm\/bin\/pnpm\.mjs/)
  assert.doesNotMatch(pnpmCli, /node_modules\/\.bin/)
  assert.match(build, /launcher\/linux\/pnpm[\s\S]+STAGE\/launcher\/pnpm/)
  assert.match(attributes, /^launcher\/linux\/dsh text eol=lf$/m)
  assert.match(attributes, /^launcher\/linux\/pnpm text eol=lf$/m)
  assert.match(attributes, /^\*\.rs text eol=lf$/m)
  assert.match(cli, /\['win32',\s*'darwin',\s*'linux'\]/)
})

test('Linux packaging and real product smokes run independently on x64 and arm64', async () => {
  const [workflow, build, updateSmoke, portableSmoke, appImagePluginSmoke] = await Promise.all([
    read('.github/workflows/ci.yml'),
    read('scripts/build-linux.sh'),
    read('scripts/smoke-update-artifact.mjs'),
    read('scripts/smoke-portable.mjs'),
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
  assert.ok(
    (workflow.match(/libayatana-appindicator3-1/g) ?? []).length >= 2,
    'every Linux job that launches the native tray host installs its runtime dependency',
  )
  assert.match(build, /zip -q -y -r "\$UPDATE_COMPONENT"/)
  assert.match(updateSmoke, /execFileAsync\('zip', \['-q', '-y', '-r', probeArchive/)
  assert.match(portableSmoke, /dsh\.stderr\.log/)
  assert.match(portableSmoke, /nativeHost\?\.output\(\)/)
  assert.match(appImagePluginSmoke, /APPIMAGE_EXTRACT_AND_RUN=1/)
  assert.match(appImagePluginSmoke, /if ! mutation="\$\(run_dsh[\s\S]+printf[^\n]+mutation/)
  assert.match(appImagePluginSmoke, /plugin --profile "\$PROFILE" add/)
  assert.match(appImagePluginSmoke, /--dump-config/)
  assert.match(appImagePluginSmoke, /DSH-Portable-data/)
  assert.match(appImagePluginSmoke, /mv "\$ROOT" "\$MOVED"/)
})

test('Linux CI dependency installation is bounded, retryable, and shared by every product job', async () => {
  const [workflow, installer] = await Promise.all([
    read('.github/workflows/ci.yml'),
    read('scripts/install-linux-packages.sh'),
  ])
  assert.doesNotMatch(workflow, /sudo\s+apt-get\s+(?:update|install)/)
  assert.equal(
    (workflow.match(/bash scripts\/install-linux-packages\.sh/g) ?? []).length,
    4,
    'all four Linux jobs must use the bounded package installer',
  )
  assert.match(installer, /DEBIAN_FRONTEND=noninteractive/)
  assert.match(installer, /APT_MAX_ATTEMPTS=2/)
  assert.match(installer, /APT_TIMEOUT_SECONDS=600/)
  assert.match(installer, /timeout\s+--foreground[\s\S]+APT_TIMEOUT_SECONDS/)
  assert.match(installer, /Acquire::Retries=2/)
  assert.match(installer, /Acquire::http::Timeout=20/)
  assert.match(installer, /Acquire::https::Timeout=20/)
  assert.match(installer, /normalize_github_apt_mirror/)
  assert.match(installer, /GITHUB_ACTIONS:-/)
  assert.match(installer, /dpkg --print-architecture/)
  assert.match(installer, /https:\/\/archive\.ubuntu\.com\/ubuntu\//)
  assert.match(installer, /https:\/\/ports\.ubuntu\.com\/ubuntu-ports\//)
  assert.match(installer, /\/etc\/apt\/apt-mirrors\.txt/)
  assert.match(installer, /apt-get[\s\S]+update/)
  assert.match(installer, /apt-get[\s\S]+install[\s\S]+--no-install-recommends/)
  assert.doesNotMatch(installer, /curl[^\n]*\|\s*(?:ba)?sh/)
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
