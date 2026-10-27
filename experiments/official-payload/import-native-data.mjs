import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { copyFile, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rmdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { inspectDataArchive, restoreDataArchive } from '../../launcher/data-transfer.mjs'
import { layoutForRoot } from '../../launcher/portable-core.mjs'

// Maintenance entry, run from a checkout with Node 24. The pure package needs no
// Node installation or new runtime adapter. Use the Native data-export format.
async function emptyDirectories(directory, found = []) {
  let entries
  try { entries = await readdir(directory, { withFileTypes: true }) }
  catch (error) { if (error.code === 'ENOENT') return found; throw error }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error('Import requires a fresh desktop data directory; existing data was preserved.')
    await emptyDirectories(path.join(directory, entry.name), found)
  }
  found.push(directory)
  return found
}

export async function importNativeData(archive, desktopRoot, { workspaceRoot = process.cwd(), passwordFile } = {}) {
  const workspace = await realpath(workspaceRoot)
  function localPath(value) {
    const target = path.resolve(workspace, value)
    // path.relative follows the current platform's casing rules without admitting
    // the workspace itself, a sibling with the same prefix, or another volume.
    const relative = path.relative(workspace, target)
    if (relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) return target
    throw new Error('Migration path escapes the selected working directory.')
  }
  async function plainPath(filename) {
    for (let current = localPath(filename); path.relative(workspace, current); current = path.dirname(current)) {
      localPath(current)
      try {
        const entry = await lstat(current)
        if (entry.isSymbolicLink()) throw new Error('Redirected migration paths are not supported.')
      } catch (error) { if (error.code !== 'ENOENT') throw error }
    }
  }
  async function readPassword() {
    if (passwordFile === undefined) return undefined
    const filename = localPath(passwordFile)
    await plainPath(filename)
    const before = await lstat(filename)
    if (!before.isFile() || before.size > 4096) throw new Error('The password file must be a regular file of at most 4096 bytes.')
    const handle = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
    try {
      const entry = await handle.stat()
      if (!entry.isFile() || entry.dev !== before.dev || entry.ino !== before.ino || entry.size > 4096) {
        throw new Error('The password file changed while it was being opened.')
      }
      // Bound the read too, in case the file grows after stat. Match Native's
      // password-file convention: remove trailing newlines, preserve other text.
      const bytes = Buffer.alloc(4097)
      let length = 0
      while (length < bytes.length) {
        const result = await handle.read(bytes, length, bytes.length - length, length)
        if (!result.bytesRead) break
        length += result.bytesRead
      }
      if (length > 4096) throw new Error('The password file must be at most 4096 bytes.')
      const password = bytes.subarray(0, length).toString('utf8').replace(/[\r\n]+$/, '')
      if (!password) throw new Error('The password file is empty.')
      return password
    } finally { await handle.close() }
  }
  archive = localPath(archive)
  desktopRoot = localPath(desktopRoot)
  await plainPath(desktopRoot)
  await plainPath(archive)
  if (!(await lstat(localPath(desktopRoot))).isDirectory()) throw new Error('Desktop root must already exist.')
  desktopRoot = localPath(await realpath(localPath(desktopRoot)))
  const data = path.join(desktopRoot, 'data')
  await plainPath(data)
  await emptyDirectories(data)
  const archiveStat = await lstat(localPath(archive))
  if (!archiveStat.isFile() || archiveStat.size > 512 * 1024 * 1024) throw new Error('Native data package is not a supported regular file.')
  const password = await readPassword()
  const stage = await mkdtemp(path.join(desktopRoot, '.native-import-'))
  const layout = { ...layoutForRoot(stage), workspace: path.join(data, 'workspace') }
  try {
    // Inspect, restore and identify the same private snapshot even if an export
    // replaces its original filename while migration is running.
    const snapshot = path.join(stage, 'source.dshdata')
    await copyFile(localPath(archive), localPath(snapshot), constants.COPYFILE_EXCL)
    const input = await inspectDataArchive(snapshot, { password })
    const categories = ['settings', 'sessions', 'workspace'].filter(value => input.categories.includes(value))
    const userFiles = input.files.filter(value => value === 'data/dsh-home/settings.yaml'
      || ['data/dsh-home/.agent-presets/', 'data/dsh-home/sessions/', 'data/dsh-home/storages/', 'workspace/'].some(prefix => value.startsWith(prefix)))
    if (!userFiles.length) throw new Error('The archive has no supported Native user data; launcher preferences alone cannot be migrated.')
    if (!input.portableWorkspace && userFiles.some(value => value.startsWith('workspace/') || value.startsWith('data/dsh-home/sessions/') || value.startsWith('data/dsh-home/storages/'))) {
      throw new Error('Export again from Native: workspace metadata is required to relocate history safely.')
    }
    // Reuse archive path, digest, decompression, journal and session-header
    // guards; never install old plugins or restore their credentials.
    await restoreDataArchive(layout, snapshot, { includeCategories: categories, password })
    const result = path.join(stage, 'prepared-data')
    await mkdir(result)
    for (const [source, destination] of [[path.join(layout.dataDir, 'dsh-home'), 'dsh-home'], [path.join(stage, 'workspace'), 'workspace']]) {
      try { await rename(source, path.join(result, destination)) }
      catch (error) { if (error.code !== 'ENOENT') throw error }
    }
    // Native window/launcher preferences, profiles, browser state and credentials
    // are deliberately not committed. Electron creates its own desktop profile;
    // the official settings importer handles settings.yaml on its first launch.
    await mkdir(path.join(result, 'launcher'))
    const receipt = {
      schemaVersion: 1, kind: 'native-data-import', importedAt: new Date().toISOString(),
      archiveSha256: createHash('sha256').update(await readFile(snapshot)).digest('hex'),
      categories, importedFiles: userFiles.length,
      workspace: layout.workspace, excluded: ['plugins', 'credentials', 'browser', 'native-launcher-preferences'],
    }
    await writeFile(path.join(result, 'launcher/native-import.json'), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' })
    // Recheck immediately before committing. Only rmdir is used on an empty
    // target: a concurrent launcher/write causes failure, never recursive loss.
    await plainPath(data)
    for (const directory of await emptyDirectories(data)) await rmdir(directory)
    await rename(result, data)
    return { ...receipt, data, stagingDirectory: stage }
  } catch (error) {
    // Keep the isolated staging tree for diagnosis/recoverable cleanup. It was
    // never exposed as live data, and no existing user files are removed.
    error.stagingDirectory = stage
    throw error
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [archive, desktopRoot, flag, passwordFile, ...extra] = process.argv.slice(2)
    if (!archive || !desktopRoot || extra.length || (flag !== undefined && (flag !== '--password-file' || !passwordFile))) {
      throw new Error('usage: node experiments/official-payload/import-native-data.mjs <Native.dshdata> <fresh-desktop-root> [--password-file <local-file>]')
    }
    console.log(JSON.stringify(await importNativeData(archive, desktopRoot, { passwordFile }), null, 2))
  } catch (error) {
    console.error(JSON.stringify({ error: error.message, stagingDirectory: error.stagingDirectory }))
    process.exitCode = 1
  }
}
