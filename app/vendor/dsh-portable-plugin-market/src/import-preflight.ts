/** Import installed host entries in a disposable process, before hot mounting.
 * This checks ESM linkage and top-level initialization, not plugin lifecycle or
 * model behavior. It is process isolation, not a sandbox for untrusted code.
 */
import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { load } from 'js-yaml'
import { findDshInstallDir } from './check.ts'
import { entryArtifactExists } from './profile.ts'

export interface ImportPreflightResult {
  ok: boolean
  checked: string[]
  detail?: string
}

const probe = `
import { pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
const [profile, encoded, host] = process.argv.slice(1);
const parent = pathToFileURL(profile + '/package.json').href;
if (host) registerHooks({resolve(specifier, context, nextResolve) {
  try { return nextResolve(specifier, context); }
  catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND' || specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('#') || specifier.includes(':')) throw error;
    return nextResolve(specifier, {...context, parentURL:pathToFileURL(host + '/package.json').href});
  }
}});
const checked = [];
try {
  for (const name of JSON.parse(encoded)) {
    await import(import.meta.resolve(name, parent));
    checked.push(name);
  }
  process.stdout.write('\\nDSH_IMPORT_PREFLIGHT:' + JSON.stringify({ok:true,checked}) + '\\n', () => process.exit(0));
} catch (error) {
  process.stdout.write('\\nDSH_IMPORT_PREFLIGHT:' + JSON.stringify({ok:false,checked,detail:String(error?.stack ?? error).slice(0,4000)}) + '\\n', () => process.exit(1));
}
`

/** Read loader rows, not arbitrary `name` fields inside a plugin's config. */
function importTargets(dir: string): string[] {
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { dsh?: { bundle?: { patch?: string } } }
  if (!manifest.dsh?.bundle?.patch) return []
  const targets: string[] = []
  const visit = (rows: unknown): void => {
    if (!Array.isArray(rows)) return
    for (const row of rows) {
      if (row === null || typeof row !== 'object') continue
      const value = row as { name?: unknown; insert?: unknown; children?: unknown }
      if (typeof value.name === 'string') targets.push(value.name)
      visit(value.insert)
      visit(value.children)
    }
  }
  visit(load(readFileSync(join(dir, manifest.dsh.bundle.patch), 'utf8')))
  return targets
}

export async function preflightPluginImports(
  profileDirectory: string,
  packages: readonly string[],
  options: { timeoutMs?: number; node?: string; dshInstallDir?: string | null } = {},
): Promise<ImportPreflightResult> {
  const entries = new Set<string>()
  for (const name of packages) {
    const dir = join(profileDirectory, 'node_modules', name)
    let targets: string[]
    try { targets = importTargets(dir) }
    catch (error) { return { ok: false, checked: [], detail: `${name}: ${String(error)}` } }
    // Carriers and subpath-only plugins must be checked at the actual loader
    // targets, not at a nonexistent or unrelated root entry.
    if (targets.length > 0) {
      for (const target of targets) {
        if (!target.includes(':') && !target.includes('$')) entries.add(target)
      }
    } else if (entryArtifactExists(dir)) entries.add(name)
  }
  if (entries.size === 0) return { ok: true, checked: [] }
  return await new Promise(resolve => {
    execFile(options.node ?? process.execPath, [
      '--experimental-import-meta-resolve', '--input-type=module', '-e', probe,
      profileDirectory, JSON.stringify([...entries]), options.dshInstallDir === undefined ? findDshInstallDir() ?? '' : options.dshInstallDir ?? '',
    ], { cwd: profileDirectory, windowsHide: true, timeout: options.timeoutMs ?? 20_000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      const record = stdout.split(/\r?\n/).reverse().find(line => line.startsWith('DSH_IMPORT_PREFLIGHT:'))
      if (record !== undefined) {
        try {
          const result = JSON.parse(record.slice('DSH_IMPORT_PREFLIGHT:'.length)) as ImportPreflightResult
          if (result.ok === false || (result.ok === true && error === null)) { resolve(result); return }
        } catch { /* malformed completion must not count as a pass */ }
      }
      resolve({ ok: false, checked: [], detail: error?.killed ? 'Plugin import check timed out' : (stderr || error?.message || 'Plugin import check did not complete').slice(-4000) })
    })
  })
}
