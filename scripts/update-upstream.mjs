import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { appendFile, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluateUpstream } from './upstream-state.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tag = process.argv.includes('--latest') ? 'latest' : 'next'
const headers = {
  accept: 'application/vnd.github+json',
  'user-agent': 'DSH-Portable-upstream-candidate',
  ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
}

async function json(url) {
  const response = await fetch(url, { headers })
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`)
  return response.json()
}

async function officialTagCommit(version) {
  const ref = await json(`https://api.github.com/repos/deepseek-ai/deepseek-harness/git/ref/tags/dsh-v${version}`)
  let object = ref?.object
  if (object?.type === 'tag') {
    const annotated = await json(`https://api.github.com/repos/deepseek-ai/deepseek-harness/git/tags/${object.sha}`)
    object = annotated?.object
  }
  if (object?.type !== 'commit' || !/^[0-9a-f]{40}$/.test(object.sha ?? '')) {
    throw new Error(`official tag dsh-v${version} does not resolve to a commit`)
  }
  return { sha: object.sha }
}

const [registry, commit, currentLock] = await Promise.all([
  json('https://registry.npmjs.org/@deepseek-ai%2Fdsh'),
  json('https://api.github.com/repos/deepseek-ai/deepseek-harness/commits/master'),
  readFile(path.join(root, 'upstream.lock.json'), 'utf8').then(JSON.parse),
])
const provisional = evaluateUpstream({
  lock: currentLock,
  registry,
  commit,
  requestedTag: tag,
})
const packageCommit = await officialTagCommit(provisional.version)
const state = evaluateUpstream({
  lock: currentLock,
  registry,
  commit,
  packageCommit,
  requestedTag: tag,
})
const { changed, version } = state
if (changed) {
  const noticesResponse = await fetch(
    `https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/${state.commit}/THIRD_PARTY_NOTICES.md`,
    {
      headers: {
        'user-agent': 'DSH-Portable-upstream-candidate',
        ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
      },
    },
  )
  if (!noticesResponse.ok) {
    throw new Error(`official notices returned HTTP ${noticesResponse.status}`)
  }
  const noticesSha256 = createHash('sha256')
    .update(Buffer.from(await noticesResponse.arrayBuffer()))
    .digest('hex')
  const marketManifestPath = path.join(root, 'app', 'vendor', 'dsh-portable-plugin-market', 'package.json')
  const marketManifest = JSON.parse(await readFile(marketManifestPath, 'utf8'))
  const settingsPeer = String(marketManifest.peerDependencies?.['@deepseek-ai/dsh-settings'] ?? '').trim()
  const verifiedTrain = `^${version}`
  const verifiedRanges = settingsPeer.split(/\s*\|\|\s*/).filter(Boolean)
  if (!verifiedRanges.includes(verifiedTrain)) {
    marketManifest.peerDependencies ??= {}
    marketManifest.peerDependencies['@deepseek-ai/dsh-settings'] = [...verifiedRanges, verifiedTrain].join(' || ')
    await writeFile(marketManifestPath, `${JSON.stringify(marketManifest, null, 2)}\n`, 'utf8')
  }

  const installArgs = [
    'install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund', '--save-exact',
    `@deepseek-ai/dsh@${version}`, `pnpm@${currentLock.pnpm.version}`,
  ]
  const npmCliCandidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(path.dirname(path.dirname(process.execPath)), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].filter(Boolean)
  const npmCli = npmCliCandidates.find((candidate) => existsSync(candidate))
  if (process.platform === 'win32' && !npmCli) {
    throw new Error(`npm CLI was not found beside the active Node runtime. Checked:\n${npmCliCandidates.join('\n')}`)
  }
  const command = process.platform === 'win32' ? process.execPath : 'npm'
  const args = process.platform === 'win32' ? [npmCli, ...installArgs] : installArgs
  const install = spawnSync(command, args, {
    cwd: path.join(root, 'app'),
    encoding: 'utf8',
    timeout: 30 * 60 * 1000,
  })
  if (install.error || install.status !== 0) {
    const signal = install.signal ? ` signal=${install.signal}` : ''
    throw new Error(`npm lock refresh failed${signal}:\n${install.error?.message || install.stderr || install.stdout}`)
  }

  const runtimeManifestPath = path.join(root, 'app', 'package.json')
  const packageLockPath = path.join(root, 'app', 'package-lock.json')
  const runtimeManifest = JSON.parse(await readFile(runtimeManifestPath, 'utf8'))
  const packageLock = JSON.parse(await readFile(packageLockPath, 'utf8'))
  const lockedDsh = packageLock.packages?.['node_modules/@deepseek-ai/dsh']
  if (lockedDsh?.version !== version || lockedDsh?.integrity !== state.integrity) {
    throw new Error('refreshed package lock does not match the official npm version and integrity')
  }
  const scriptPackages = ['@deepseek-ai/dsh-subprocess-local', '@google/genai', 'koffi', 'node-pty', 'protobufjs']
  const lockedScriptVersions = Object.fromEntries(scriptPackages.map((name) => [
    name,
    packageLock.packages?.[`node_modules/${name}`]?.version,
  ]))
  const missingScriptPackages = scriptPackages.filter((name) => !lockedScriptVersions[name])
  if (missingScriptPackages.length > 0) {
    throw new Error(`refreshed package lock is missing required runtime dependencies: ${missingScriptPackages.join(', ')}`)
  }
  runtimeManifest.version = version
  runtimeManifest.allowScripts = Object.fromEntries(scriptPackages.map((name) => [
    `${name}@${lockedScriptVersions[name]}`,
    true,
  ]))
  packageLock.version = version
  packageLock.packages[''].version = version
  await writeFile(runtimeManifestPath, `${JSON.stringify(runtimeManifest, null, 2)}\n`, 'utf8')
  await writeFile(packageLockPath, `${JSON.stringify(packageLock, null, 2)}\n`, 'utf8')
  currentLock.dsh.version = version
  currentLock.dsh.integrity = state.integrity
  currentLock.dsh.reviewedCommit = state.commit
  currentLock.dsh.noticesSha256 = noticesSha256
  const target = path.join(root, 'upstream.lock.json')
  const temporary = `${target}.tmp`
  await writeFile(temporary, `${JSON.stringify(currentLock, null, 2)}\n`, 'utf8')
  await rename(temporary, target)
}

const result = {
  changed,
  packageChanged: state.packageChanged,
  sourceChanged: state.sourceChanged,
  tag: state.selectedTag,
  version,
  commit: state.commit,
  sourceCommit: state.sourceCommit,
}
console.log(JSON.stringify(result, null, 2))
if (process.env.GITHUB_OUTPUT) {
  await appendFile(process.env.GITHUB_OUTPUT, [
    `changed=${changed}`,
    `version=${version}`,
    `commit=${state.commit}`,
    `source_commit=${state.sourceCommit}`,
    `source_changed=${state.sourceChanged}`,
    '',
  ].join('\n'))
}
