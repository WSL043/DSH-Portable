import { readFile, mkdir, writeFile, appendFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const repository = 'deepseek-ai/deepseek-harness';
// Shared seams reviewed with the desktop baseline. Package-wide monitoring
// catches new entry points as well as changes to the currently reviewed files.
const sharedDesktopPackages = [
  'packages/util/home-paths/',
  'packages/boot/app-boot/',
  'packages/boot/plugin-manager/',
  'packages/boot/plugin-market/',
  'packages/client/connection/',
  'packages/client/ui-plugin-manager/',
  'packages/client/ui-plugin-market/',
  'packages/api/gateway/',
  'packages/host/webserver/',
  'packages/mcp/mcp-client/',
  'packages/experimental/plugin-market-bundle/',
];
export function desktopFiles(tree) {
  if (tree.truncated || !Array.isArray(tree.tree)) throw new Error('Incomplete upstream tree; desktop review cannot be trusted');
  return Object.fromEntries(tree.tree.filter(x => x.type === 'blob' &&
    (/^(apps\/desktop(?:-host)?\/|packages\/desktop[^/]*\/)/.test(x.path)
      || sharedDesktopPackages.some(prefix => x.path.startsWith(prefix))
      // External SDK versions and transitive security fixes live in the lockfile.
      || x.path === 'pnpm-lock.yaml')).map(x => [x.path, x.sha]));
}
export function changesBetween(before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
    .filter(path => before[path] !== after[path])
    .map(path => ({ path, status: !before[path] ? 'added' : !after[path] ? 'removed' : 'modified' }));
}
async function api(path) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const response = await fetch(`https://api.github.com/repos/${repository}/${path}`, {
    headers: { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Upstream GitHub request failed: ${response.status} (${path})`);
  return response.json();
}
async function main() {
  const baseline = JSON.parse(await readFile(new URL('../docs/official-desktop-baseline.json', import.meta.url)));
  const output = resolve(process.argv[2] || 'build/official-desktop-intake');
  const head = await api('commits/master');
  const [before, after, releases] = await Promise.all([
    api(`git/trees/${baseline.commit}?recursive=1`), api(`git/trees/${head.sha}?recursive=1`),
    api('releases?per_page=10'),
  ]);
  const changes = changesBetween(desktopFiles(before), desktopFiles(after));
  const report = {
    checkedAt: new Date().toISOString(), repository, baseline: baseline.commit, head: head.sha, changes,
    sourceScope: { desktop: ['apps/desktop/', 'apps/desktop-host/', 'packages/desktop*/'],
      sharedPackages: sharedDesktopPackages, dependencyLock: 'pnpm-lock.yaml' },
    releaseScope: 'Latest ten GitHub releases only; other distribution channels are not checked. Assets are not downloaded or signature-verified.',
    releases: releases.map(r => ({ tag: r.tag_name, url: r.html_url, prerelease: r.prerelease,
      assets: r.assets.map(a => ({ name: a.name, size: a.size, url: a.browser_download_url })) })),
    qualified: false,
  };
  const summary = ['## Official desktop review', '', `Baseline: ${baseline.commit}`, `Observed: ${head.sha}`,
    '', `${changes.length} changed files in desktop and reviewed shared-package source scope.`,
    'Source discovery only: no compatibility, signature or release qualification is implied.',
    'GitHub release inventory covers the latest ten releases; it does not cover external distribution.', '',
    ...changes.map(c => `- ${c.status}: ${c.path}`), ''].join('\n');
  await mkdir(output, { recursive: true });
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(join(output, 'summary.md'), summary);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
  console.log(summary);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
