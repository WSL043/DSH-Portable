import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function patchDshDependencyLock({ workspace, lock, version, integrity }) {
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  assert(/^4\.\d+\.\d+$/.test(version) && /^sha512-[A-Za-z0-9+/]+={0,2}$/.test(integrity), 'Invalid reviewed Zod identity');
  const versions = [...new Set([...lock.matchAll(/^  zod@(4\.\d+\.\d+):$/gm)].map(m => m[1]))];
  assert(versions.length <= 1, 'Multiple source Zod versions require separate review');
  const old = versions[0];
  if (!old || old.split('.').map(Number).reduce((c, n, i) => c || Math.sign(n - Number(version.split('.')[i])), 0) >= 0) {
    return { workspace, lock, status: 'upstream-already-fixed-or-no-v4', from: old ?? null, to: version };
  }
  function addOverride(text) {
    assert((text.match(/^overrides:\r?$/gm) ?? []).length === 1, 'Expected one existing override mapping');
    assert(!text.includes(`zod@>=4 <${version}`), 'Unexpected preexisting source override');
    return text.replace(/^overrides:\r?\n/m, `overrides:\n  'zod@>=4 <${version}': ${version}\n`);
  }
  const escaped = old.replaceAll('.', '\\.');
  const resolution = new RegExp(`(\\n  zod@${escaped}:\\n    resolution: \\{integrity: )[^\\n}]+(\\}\\n)`);
  assert(resolution.test(lock), 'Unrecognized upstream Zod resolution');
  lock = lock.replace(resolution, `$1${integrity}$2`);
  lock = lock.replaceAll(`zod@${old}`, `zod@${version}`)
    .replace(new RegExp(`(\\n\\s+zod:\\n\\s+specifier:) [^\\n]+(\\n\\s+version:) ${escaped}(?=\\n)`, 'g'), `$1 ${version}$2 ${version}`)
    .replace(new RegExp(`(\\n\\s+zod:) ${escaped}(?=\\n)`, 'g'), `$1 ${version}`);
  assert(!lock.includes(`zod@${old}`), 'Old source Zod identity remains');
  return { workspace: addOverride(workspace), lock: addOverride(lock), status: 'patched', from: old, to: version };
}

async function prepareReviewedSourceDependencies() {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const crypto = await import('node:crypto');
  const { execFileSync } = await import('node:child_process');
  const { parseArgs } = await import('node:util');
  const { values } = parseArgs({ options: { source: { type: 'string' }, lock: { type: 'string' }, 'dependency-lock': { type: 'string' }, output: { type: 'string' } } });
  const source = path.resolve(values.source), pins = JSON.parse(await fs.readFile(path.resolve(values.lock), 'utf8'));
  const actualCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8', windowsHide: true, shell: false }).trim();
  if (actualCommit !== pins.dsh.reviewedCommit) throw new Error('Source commit differs from selected reviewed core');
  const dependencyPins = values['dependency-lock'] ? JSON.parse(await fs.readFile(path.resolve(values['dependency-lock']), 'utf8')) : pins;
  const zod = dependencyPins.dsh.buildDependencies?.zod;
  if (!zod) throw new Error('Missing reviewed source dependency identity');
  const lockPath = path.join(source, 'pnpm-lock.yaml'), workspacePath = path.join(source, 'pnpm-workspace.yaml');
  const beforeLock = await fs.readFile(lockPath, 'utf8'), beforeWorkspace = await fs.readFile(workspacePath, 'utf8');
  const result = patchDshDependencyLock({ lock: beforeLock, workspace: beforeWorkspace, ...zod });
  const sha = text => crypto.createHash('sha256').update(text).digest('hex');
  await fs.writeFile(lockPath, result.lock);
  await fs.writeFile(workspacePath, result.workspace);
  const receipt = { sourceCommit: actualCommit, dependency: { name: 'zod', ...zod }, status: result.status, from: result.from,
    originalLockSha256: sha(beforeLock), resolvedLockSha256: sha(result.lock),
    originalWorkspaceSha256: sha(beforeWorkspace), resolvedWorkspaceSha256: sha(result.workspace),
    installPolicy: 'pnpm install --frozen-lockfile; no general dependency re-resolution' };
  await fs.mkdir(path.dirname(path.resolve(values.output)), { recursive: true });
  await fs.writeFile(path.resolve(values.output), JSON.stringify(receipt, null, 2) + '\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await prepareReviewedSourceDependencies();
