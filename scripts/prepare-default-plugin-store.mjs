// Resolve default-plugin dependencies during the build, never on first launch.
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const stage = path.resolve(process.argv[2] || '');
if (!process.argv[2]) throw Error('Provide the staged Portable root.');
const archiveRoot = path.join(stage, 'default-plugins');
const runtimeRoot = path.resolve(process.argv[3] || stage);
const pnpmRoot = path.join(runtimeRoot, 'app/node_modules/pnpm');
const pnpmManifest = JSON.parse(await readFile(path.join(pnpmRoot, 'package.json'), 'utf8'));
const archives = (await readdir(archiveRoot)).filter(name => name.endsWith('.tgz'));
if (!archives.length) throw Error('No reviewed default-plugin archives.');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'dsh-default-store-'));
try {
  await mkdir(path.join(temporary, '.dsh-portable-archives'));
  const dependencies = {};
  for (const archive of archives) {
    await copyFile(path.join(archiveRoot, archive), path.join(temporary, '.dsh-portable-archives', archive));
    dependencies[archive.replace(/\.tgz$/, '')] = `file:.dsh-portable-archives/${archive}`;
  }
  await writeFile(path.join(temporary, 'package.json'), JSON.stringify({private:true,dependencies}));
  await copyFile(new URL('./default-plugin-store/pnpm-lock.yaml', import.meta.url), path.join(temporary, 'pnpm-lock.yaml'));
  const result = spawnSync(process.execPath, [path.join(pnpmRoot, pnpmManifest.bin.pnpm),
    'install', '--frozen-lockfile',
    '--store-dir', path.join(archiveRoot, 'store'),
    '--cache-dir', path.join(archiveRoot, 'store', 'metadata'), '--ignore-scripts',
    '--config.auto-install-peers=false', '--config.minimum-release-age=0',
  ], {cwd:temporary,windowsHide:true,encoding:'utf8',timeout:120000});
  if(result.error) throw result.error;
  if(result.status!==0) throw Error(`Default-plugin store preparation failed: ${result.stderr}`);
  await copyFile(path.join(temporary, 'pnpm-lock.yaml'), path.join(archiveRoot, 'pnpm-lock.yaml'));
  const clsxPackage = (await readdir(path.join(temporary, 'node_modules/.pnpm'))).find(name => name.startsWith('clsx@'));
  if (!clsxPackage) throw Error('Expected locked clsx dependency is missing.');
  await copyFile(path.join(temporary, 'node_modules/.pnpm', clsxPackage, 'node_modules/clsx/license'), path.join(stage, 'licenses/clsx-LICENSE.txt'));
  for (const entry of await readdir(path.join(archiveRoot,'store'),{withFileTypes:true})) {
    if(entry.isDirectory() && /^v\d+$/.test(entry.name)) {
      await rm(path.join(archiveRoot,'store',entry.name,'projects'),{recursive:true,force:true});
    }
  }
  console.log('Default-plugin dependency store prepared.');
} finally { await rm(temporary,{recursive:true,force:true}); }
