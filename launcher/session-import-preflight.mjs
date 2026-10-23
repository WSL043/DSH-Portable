import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { lstat, readFile, readdir } from 'node:fs/promises'
import { dataPathKey, normalizeDataPath, safeDataTarget } from './data-paths.mjs'

const BACKEND = '@deepseek-ai/dsh-session-persistence-jsonl'
const INCLUDE = '@deepseek-ai/cordis-plugin-include'
const SESSION = /^session(?:\.v[1-9]\d*)?\.jsonl(\.zstd)?$/
const incompatible = (message, cause) => Object.assign(new Error(
  'Session import is incompatible: ' + message + ' Use a separate environment or export with matching session compression.',
  cause ? { cause } : undefined), { code: 'DSH_DATA_IMPORT_SESSION_INCOMPATIBLE' })
async function present(filename) {
  try { return await lstat(filename) } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

// Inspect the prospective files, never initialize a profile or evaluate !!js.
export async function assertImportedSessionCompatibility(layout, plannedFiles) {
  try {
    const key = value => dataPathKey(value, layout.platform)
    const planned = new Map()
    for (const file of plannedFiles) {
      const relative = normalizeDataPath(file.path, layout.platform)
      if (!Buffer.isBuffer(file.bytes) || planned.has(key(relative))) throw new Error('Invalid import plan.')
      planned.set(key(relative), { ...file, path: relative })
    }
    const relative = absolute => normalizeDataPath(path.relative(layout.stateRoot, absolute).replaceAll('\\', '/'))
    const home = relative(layout.dshHome)
    const sessions = home + '/sessions'
    const artifacts = new Map()
    function remember(filename) {
      const name = filename.split('/').at(-1)
      if (filename.startsWith(sessions + '/') && SESSION.test(name)) {
        artifacts.set(key(filename), name.endsWith('.zstd') ? 'zstd' : 'none')
      }
    }
    async function scan(directory) {
      const filename = await safeDataTarget(layout.stateRoot, directory, { leaf: 'any', createParents: false })
      if (!filename) return
      const info = await lstat(filename)
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Unsafe session directory: ' + directory)
      for (const entry of await readdir(filename, { withFileTypes: true })) {
        const child = directory + '/' + entry.name
        if (entry.isDirectory()) await scan(child)
        else {
          const checked = await safeDataTarget(layout.stateRoot, child, { createParents: false })
          if (!checked) throw new Error('Session file changed during inspection.')
          remember(child)
        }
      }
    }
    await scan(sessions)
    for (const file of planned.values()) remember(file.path)
    const modes = new Set(artifacts.values())
    if (modes.size > 1) throw new Error('The resulting session root would mix none and zstd artifacts.')
    const compression = [...modes][0] ?? null
    if (!layout.dshBin || !await present(layout.dshBin)) return { scope: 'archive-only', compression, sessions: artifacts.size }
    if (!compression) return { scope: 'no-sessions', compression, sessions: 0 }
    if (!layout.appDir) throw new Error('The selected runtime has no app directory.')
    const require = createRequire(path.join(layout.appDir, 'package.json'))
    const load = name => import(pathToFileURL(require.resolve(name)).href)
    const boot = await load('@deepseek-ai/dsh-app-boot')
    const include = await load(INCLUDE)
    const yaml = require('js-yaml')
    if (!include.entryListSchema || typeof boot.composeEntries !== 'function') throw new Error('Selected runtime has no offline Cordis parser.')
    async function bytesAt(filename) {
      const rel = relative(filename)
      const checked = await safeDataTarget(layout.stateRoot, rel, { createParents: false })
      if (planned.has(key(rel))) return planned.get(key(rel)).bytes
      return checked ? readFile(checked) : null
    }
    function patches(bytes, filename) {
      if (bytes === null) return []
      const rows = yaml.load(bytes.toString('utf8'), { schema: include.entryListSchema })
      if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) {
        throw new Error('Invalid Cordis patch list: ' + filename)
      }
      return rows
    }
    const profileDir = path.join(layout.dshHome, 'profiles', 'web')
    const manifestBytes = await bytesAt(path.join(profileDir, 'package.json'))
    const manifest = manifestBytes === null ? null : JSON.parse(manifestBytes.toString('utf8'))
    if (manifestBytes !== null && (!manifest || typeof manifest !== 'object' || Array.isArray(manifest))) {
      throw new Error('Invalid web profile manifest.')
    }
    const baseFile = path.join(profileDir, 'cordis.yml')
    if (patches(await bytesAt(baseFile), baseFile).length) throw new Error('Non-empty profile base configuration cannot be verified offline.')
    const bundles = manifestBytes === null ? boot.PROFILE_TEMPLATES?.web?.bundles : manifest?.dsh?.profile?.bundles
    if (!Array.isArray(bundles) || !bundles.every(name => typeof name === 'string')) throw new Error('Unknown web profile bundles.')
    const anchor = path.join(layout.appDir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
    const layers = []
    for (const name of bundles) {
      const directory = boot.resolveBundleDir('dsh', name, anchor, profileDir)
      const installed = boot.readProfileManifest('dsh', directory)
      const ownership = path.relative(layout.appDir, directory)
      if (ownership === '..' || ownership.startsWith('..' + path.sep) || path.isAbsolute(ownership)) {
        const specs = ['dependencies', 'optionalDependencies', 'devDependencies'].map(field => manifest?.[field]?.[name]).filter(value => value !== undefined)
        const spec = specs[0]
        if (specs.some(value => value !== spec)) throw new Error('Ambiguous profile-owned bundle dependency: ' + name)
        if (typeof spec !== 'string' || typeof installed.version !== 'string') throw new Error('Unknown profile-owned bundle dependency: ' + name)
        if (spec !== installed.version) {
          // Preserve the existing fixed default archive binding, never guess the
          // version of an archive that this import will replace before install.
          const fixed = ['dsh-chat-manager', 'dsh-image-viewer'].includes(name)
            && spec === 'file:.dsh-portable-archives/' + name + '.tgz'
          const originalFile = await safeDataTarget(layout.stateRoot, relative(path.join(profileDir, 'package.json')), { createParents: false })
          const original = originalFile ? JSON.parse(await readFile(originalFile, 'utf8')) : null
          const archive = relative(path.join(profileDir, '.dsh-portable-archives', name + '.tgz'))
          if (!fixed || original?.dependencies?.[name] !== spec || planned.has(key(archive))
            || !await safeDataTarget(layout.stateRoot, archive, { createParents: false })) {
            throw new Error('Profile-owned bundle may change during dependency restoration: ' + name)
          }
        }
      }
      const bundle = installed.dsh?.bundle
      if (!bundle) throw new Error('Unknown profile bundle: ' + name)
      for (const filename of boot.bundlePatchPaths(directory, bundle)) {
        const inside = path.relative(directory, filename)
        if (!inside || inside === '..' || inside.startsWith('..' + path.sep) || path.isAbsolute(inside)) throw new Error('Unsafe bundle patch path.')
        layers.push(patches(await readFile(filename), filename))
      }
    }
    for (const filename of [path.join(profileDir, 'cordis.patch.yml'), path.join(layout.dshHome, 'cordis.patch.yml')]) {
      layers.push(patches(await bytesAt(filename), filename))
    }
    if (layout.desktopBridgePatch) layers.push(patches(await readFile(layout.desktopBridgePatch), layout.desktopBridgePatch))
    const entries = boot.composeEntries(layers)
    const backends = []
    function visit(rows, ancestors = []) {
      for (const row of rows) {
        if (row.disabled === true || ancestors.includes(true)) continue
        if (row.name === INCLUDE || row.name === 'include' || row.name && typeof row.name !== 'string') {
          throw new Error('Dynamic or nested include configuration cannot be verified offline.')
        }
        if (row.name === BACKEND) backends.push({ row, flags: [...ancestors, row.disabled] })
        if (row.group || row.name === 'cordis:group') {
          if (!Array.isArray(row.config)) throw new Error('Unknown group configuration.')
          visit(row.config, [...ancestors, row.disabled])
        }
      }
    }
    visit(entries)
    if (backends.length !== 1) throw new Error('Expected exactly one session backend.')
    const { row, flags } = backends[0]
    if (flags.some(value => value !== undefined && value !== false)) throw new Error('Dynamic session backend activation.')
    const config = row.config
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Unknown session backend configuration.')
    const configuredRoot = config.root
    const standardRoot = configuredRoot && typeof configuredRoot === 'object'
      && Object.keys(configuredRoot).length === 1
      && /^dshHomePath\((['"])sessions\1\)$/.test(configuredRoot.__jsExpr)
    const root = standardRoot ? path.join(layout.dshHome, 'sessions')
      : typeof configuredRoot === 'string' ? path.resolve(layout.workspace, configuredRoot) : null
    const same = value => layout.platform === 'win32' ? value.toLowerCase() : value
    if (!root || same(path.resolve(root)) !== same(path.resolve(layout.dshHome, 'sessions'))) throw new Error('Session backend root is dynamic or differs from the imported root.')
    if (config.compression !== undefined && typeof config.compression !== 'string') throw new Error('Dynamic session compression.')
    const backend = await load(BACKEND)
    if (typeof backend.JsonlCompressionSchema !== 'function') throw new Error('Selected runtime has no compression schema.')
    const effective = backend.JsonlCompressionSchema(config.compression)
    if (!['none', 'zstd'].includes(effective) || effective !== compression) throw new Error('Session artifacts do not match the final backend compression.')
    return { scope: 'runtime', compression: effective, sessions: artifacts.size, profile: 'web', root }
  } catch (error) {
    throw incompatible(error.message, error)
  }
}
