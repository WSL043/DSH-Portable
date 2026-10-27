// The shell/core contract: the interface an installed Portable shell (launcher, native host) and a runtime capsule
// (the app directory a core update replaces) agree on. A core qualified for one shell is accepted by every shell that
// carries the same `contract` number, whatever its Portable version or fingerprint (see evaluateUpdate).
//
// That is only honest while the interface really stays put, so this file watches it. For each kind of coupling it lists
// what the shell offers and what the app names of it:
//   env     environment variables the shell hands to the app
//   bridge  `dsh-portable/*` messages the page and the native host exchange
//   cli     portable-cli commands the app's bridge server runs
//   flag    portable-cli options those commands pass
//   file    launcher scripts the app reaches by path
//   capsule the capsule file format the launcher can read, and the one the packer writes
//   layout  paths inside the app directory the shell expects to find (the other way round: the shell is the one asking)
// config/shell-contract.json is the frozen record. A change to either side that breaks it fails the contract test until
// it is dealt with on purpose:
//
//   node scripts/shell-contract.mjs update   a compatible change (the shell gained something): refresh the record
//   node scripts/shell-contract.mjs bump     a breaking change: raise the contract number and refresh the record
//
// A bump means older shells stop accepting new cores until the user updates Portable, so it is reserved for changes
// an older shell cannot serve. What this cannot see (behaviour behind an unchanged name) still needs a bump by hand.
import { readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const CONTRACT_FILE = 'config/shell-contract.json'
export const KINDS = ['env', 'bridge', 'cli', 'flag', 'file', 'capsule', 'layout']
// Kinds where the shell asks and the app answers; every other kind has the shell offering and the app using.
const SHELL_ASKS = new Set(['layout'])
const ENV = /\bDSH_PORTABLE_[A-Z0-9]+(?:_[A-Z0-9]+)*\b(?!_)/gu
const BRIDGE = /\bdsh-portable\/[a-z][a-z0-9]*(?:-[a-z0-9]+)*\b/gu
const FLAG = /'(--[a-z][a-z0-9]*(?:-[a-z0-9]+)*)'/gu
const SHELL_COMMAND = /options\.command === '([a-z][a-z-]*)'/gu
const APP_COMMAND = /(?:(?:runCli|runUpdateRead)\(\s*|\bargs\s*=\s*)\[\s*'([a-z][a-z-]*)'/gu
const APP_LAYOUT = /\bappDir,\s*((?:'[^']+',?\s*)+)\)/gu
const CAPSULE_FORMAT = /\b(?:DSHPACK\d+|dshpack-[a-z0-9-]+)\b/gu
const APP_LAUNCHER_FILE = /'launcher',\s*'([A-Za-z0-9._-]+)'/gu

// The shell is everything under launcher/. The app side is what ends up inside the capsule and talks back to it.
const SHELL_ROOTS = ['launcher']
const SHELL_EXTENSIONS = new Set(['.cs', '.swift', '.rs', '.js', '.mjs'])
const SHELL_CLI_FILES = ['launcher/portable-cli.mjs', 'launcher/portable-core.mjs']
const APP_ROOTS = [
  { dir: 'app/vendor', pattern: /\/src\/.+\.(?:ts|tsx|mjs|js)$/u },
  { dir: 'desktop-bridge/lib', pattern: /\.(?:js|mjs)$/u },
  { dir: 'scripts', pattern: /\/patch-[^/]+\.mjs$/u },
]
const APP_CLI_FILE = 'desktop-bridge/lib/index.js'

async function filesBelow(root, relative, accept) {
  const found = []
  let entries
  try { entries = await readdir(path.join(root, relative), { withFileTypes: true }) } catch (error) { if (error?.code === 'ENOENT') return found; throw error }
  for (const entry of entries) {
    const child = `${relative}/${entry.name}`
    if (entry.isDirectory()) { if (entry.name !== 'node_modules' && entry.name !== 'target' && entry.name !== 'obj') found.push(...await filesBelow(root, child, accept)) }
    else if (entry.isFile() && accept(child)) found.push(child)
  }
  return found
}

function collect(text, pattern, ignore) {
  const found = new Set()
  for (const match of text.matchAll(pattern)) if (!ignore(match[0])) found.add(match[0])
  return found
}

function captures(text, pattern) {
  return new Set([...text.matchAll(pattern)].map((match) => match[1]))
}

// Test hooks and prefixes that are built up at run time are not part of the interface.
const isTestOnly = (name) => /^DSH_PORTABLE_TEST_/u.test(name)

const emptySide = () => Object.fromEntries(KINDS.map((kind) => [kind, new Set()]))

export async function scanShellContract(root) {
  const sides = { shell: emptySide(), app: emptySide() }
  const read = async (relative) => readFile(path.join(root, relative), 'utf8')
  const add = (side, kind, values) => { for (const value of values) side[kind].add(value) }
  for (const dir of SHELL_ROOTS) {
    for (const file of await filesBelow(root, dir, (name) => SHELL_EXTENSIONS.has(path.extname(name)) && !/\/(?:test|tests)\//u.test(name))) {
      const text = await read(file)
      add(sides.shell, 'env', collect(text, ENV, isTestOnly))
      add(sides.shell, 'bridge', collect(text, BRIDGE, () => false))
      if (/^launcher\/[^/]+\.mjs$/u.test(file)) sides.shell.file.add(file.slice('launcher/'.length))
    }
  }
  for (const file of SHELL_CLI_FILES) {
    const text = await read(file)
    add(sides.shell, 'flag', captures(text, FLAG))
    if (file.endsWith('portable-cli.mjs')) add(sides.shell, 'cli', captures(text, SHELL_COMMAND))
    if (file.endsWith('portable-core.mjs')) {
      for (const [, segments] of text.matchAll(APP_LAYOUT)) sides.shell.layout.add(['app', ...[...segments.matchAll(/'([^']+)'/gu)].map((part) => part[1])].join('/'))
    }
  }
  for (const { dir, pattern } of APP_ROOTS) {
    for (const file of await filesBelow(root, dir, (name) => pattern.test(name))) {
      const text = await read(file)
      add(sides.app, 'env', collect(text, ENV, isTestOnly))
      add(sides.app, 'bridge', collect(text, BRIDGE, () => false))
      add(sides.app, 'file', captures(text, APP_LAUNCHER_FILE))
    }
  }
  add(sides.shell, 'capsule', collect(await read('launcher/runtime-capsule.mjs'), CAPSULE_FORMAT, () => false))
  add(sides.app, 'capsule', collect(await read('scripts/create-runtime-capsule.mjs'), CAPSULE_FORMAT, () => false))
  const bridgeServer = await read(APP_CLI_FILE)
  add(sides.app, 'cli', captures(bridgeServer, APP_COMMAND))
  add(sides.app, 'flag', captures(bridgeServer, FLAG))
  const finish = (side) => Object.fromEntries(KINDS.map((kind) => [kind, [...side[kind]].sort()]))
  return { shell: finish(sides.shell), app: finish(sides.app) }
}

/**
 * What changed between the frozen record and the tree, split into what an older shell or an older capsule can live
 * with and what it cannot.
 *  - the app now names something the frozen shell never offered: a new core on an old shell breaks;
 *  - the shell dropped something both sides shared: an older core on a new shell breaks;
 *  - the app dropped a shared message: an older shell still sends it.
 * Names only the shell uses (or only the app uses) can come and go; they are not part of the agreement.
 */
export function diffShellContract(frozen, current) {
  const breaking = []
  const compatible = []
  const has = (list, name) => list.includes(name)
  for (const kind of KINDS) {
    if (SHELL_ASKS.has(kind)) {
      // A new shell that needs a path an older capsule never had breaks rolling back to that core.
      for (const name of current.shell[kind]) if (!has(frozen.shell[kind], name)) breaking.push(`the shell now expects ${kind} ${name}`)
      for (const name of frozen.shell[kind]) if (!has(current.shell[kind], name)) compatible.push(`the shell no longer expects ${kind} ${name}`)
      continue
    }
    for (const name of current.app[kind]) {
      if (!has(frozen.shell[kind], name) && !has(frozen.app[kind], name)) breaking.push(`the app now uses ${kind} ${name}, which the frozen shell never provided`)
    }
    for (const name of frozen.shell[kind]) {
      if (has(frozen.app[kind], name) && !has(current.shell[kind], name)) breaking.push(`the shell no longer provides ${kind} ${name}`)
    }
    if (kind === 'bridge') {
      for (const name of frozen.app[kind]) {
        if (has(frozen.shell[kind], name) && !has(current.app[kind], name)) breaking.push(`the app no longer handles ${kind} ${name}`)
      }
    }
    for (const name of current.shell[kind]) {
      if (!has(frozen.shell[kind], name)) compatible.push(`the shell now provides ${kind} ${name}`)
    }
    for (const name of frozen.shell[kind]) {
      if (!has(current.shell[kind], name) && !has(frozen.app[kind], name)) compatible.push(`the shell no longer has ${kind} ${name}, which the app never used`)
    }
    for (const name of current.app[kind]) {
      if (!has(frozen.app[kind], name) && has(frozen.shell[kind], name)) compatible.push(`the app now uses ${kind} ${name}, which the shell already provided`)
    }
    for (const name of frozen.app[kind]) {
      if (!has(current.app[kind], name) && kind !== 'bridge') compatible.push(`the app no longer uses ${kind} ${name}`)
    }
  }
  return { breaking: [...new Set(breaking)], compatible: [...new Set(compatible)] }
}

export async function readContractRecord(root) {
  const record = JSON.parse(await readFile(path.join(root, CONTRACT_FILE), 'utf8'))
  if (record?.schemaVersion !== 1 || !Number.isSafeInteger(record.contract) || record.contract < 1) throw new Error(`${CONTRACT_FILE} is invalid.`)
  for (const side of ['shell', 'app']) for (const kind of KINDS) if (!Array.isArray(record[side]?.[kind])) throw new Error(`${CONTRACT_FILE} lacks ${side}.${kind}.`)
  return record
}

async function writeRecord(root, contract, scan) {
  const record = { schemaVersion: 1, contract, shell: scan.shell, app: scan.app }
  await writeFile(path.join(root, CONTRACT_FILE), `${JSON.stringify(record, null, 2)}\n`, 'utf8')
  return record
}

async function main() {
  const root = path.resolve(import.meta.dirname, '..')
  const command = process.argv[2] ?? 'check'
  if (command === 'number') { process.stdout.write(`${(await readContractRecord(root)).contract}\n`); return }
  const none = { contract: 0, shell: Object.fromEntries(KINDS.map((kind) => [kind, []])), app: Object.fromEntries(KINDS.map((kind) => [kind, []])) }
  const record = await readContractRecord(root).catch((error) => (error?.code === 'ENOENT' && command !== 'check' ? none : Promise.reject(error)))
  const scan = await scanShellContract(root)
  const { breaking, compatible } = diffShellContract(record, scan)
  if (command === 'check') {
    for (const line of [...breaking.map((item) => `breaking: ${item}`), ...compatible.map((item) => `compatible: ${item}`)]) console.log(line)
    if (breaking.length > 0 || compatible.length > 0) { console.error('The shell/core interface changed. Run "node scripts/shell-contract.mjs update" (compatible) or "bump" (breaking).'); process.exitCode = 1 }
    return
  }
  if (command === 'update') {
    if (breaking.length > 0) { for (const item of breaking) console.error(`breaking: ${item}`); console.error('These break older shells or cores: run "node scripts/shell-contract.mjs bump" instead.'); process.exitCode = 1; return }
    await writeRecord(root, record.contract, scan)
    console.log(`Contract ${record.contract} refreshed (${compatible.length} compatible changes).`)
    return
  }
  if (command === 'bump') {
    await writeRecord(root, record.contract + 1, scan)
    console.log(`Contract raised to ${record.contract + 1}.`)
    return
  }
  throw new Error(`Unknown command: ${command}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
