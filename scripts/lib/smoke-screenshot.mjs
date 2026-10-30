import { randomUUID } from 'node:crypto'
import { lstat, mkdir, open, rename, rm } from 'node:fs/promises'
import path from 'node:path'

// The CLI caller chooses an output directory; screenshot names cannot escape it.
export function screenshotTarget(root, filename) {
  if (typeof filename !== 'string' || !/^[^<>:"|?*\x00-\x1f/\\]+\.png$/i.test(filename)
    || filename === '.' || filename === '..' || /[. ]$/.test(filename)
    || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])$/i.test(filename.split('.')[0].trimEnd())) {
    throw new Error('unsafe screenshot name')
  }
  const base = path.resolve(root)
  const target = path.resolve(base, filename)
  const suffix = path.relative(base, target)
  if (!suffix || path.isAbsolute(suffix) || suffix === '..' || suffix.startsWith('..' + path.sep)) {
    throw new Error('unsafe screenshot target')
  }
  return target
}

async function statIfPresent(filename) {
  try { return await lstat(filename) } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

export async function writeSmokeScreenshot(output, content) {
  if (typeof output !== 'string' || !output || output.includes('\0')
    || output.replaceAll('\\', '/').split('/').some(part => part === '..')
    || /^[A-Za-z]:[^\\/]/.test(output)) throw new Error('unsafe screenshot path')
  const base = path.dirname(path.resolve(output))
  const target = screenshotTarget(base, path.basename(output))
  let current = path.parse(base).root
  for (const part of path.relative(current, base).split(path.sep).filter(Boolean)) {
    current = path.join(current, part)
    let stat = await statIfPresent(current)
    if (!stat) {
      try { await mkdir(current) } catch (error) { if (error.code !== 'EEXIST') throw error }
      stat = await lstat(current)
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('unsafe screenshot directory')
  }
  const existing = await statIfPresent(target)
  if (existing && (existing.isSymbolicLink() || !existing.isFile())) throw new Error('unsafe screenshot file')
  const temporary = screenshotTarget(base, '.dsh-smoke-' + randomUUID() + '.png')
  let file
  try {
    file = await open(temporary, 'wx', 0o600)
    await file.writeFile(content)
    await file.close()
    file = null
    await rename(temporary, target)
  } finally {
    if (file) await file.close()
    await rm(temporary, { force: true })
  }
}
