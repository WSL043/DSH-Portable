// Internal Windows sample: reviewed official runtime + separately compiled community shell.
// No official executable or updater feed is redistributed as our application identity.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { cp, mkdir, readFile, readdir, realpath, rename, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

const [officialArg, electronArg, desktopArg, stagingArg, outputArg] = process.argv.slice(2);
if (!outputArg || process.argv.length !== 7) throw new Error('Usage: node package-alpha.mjs <official-extracted> <electron-runtime> <compiled-desktop> <new-staging> <new-output>');
if (process.platform !== 'win32') throw new Error('Only the Windows internal sample has been reviewed');
const [official, electron, desktop, staging, output] = [officialArg, electronArg, desktopArg, stagingArg, outputArg].map(p => resolve(p));
const contains = (parent, child) => {
  const distance = relative(parent, child);
  return distance === '' || (!isAbsolute(distance) && distance !== '..' && !distance.startsWith(`..${sep}`));
};
for (const target of [staging, output]) {
  for (const input of [official, electron, desktop]) {
    if (contains(input, target) || contains(target, input)) throw new Error('Build inputs and destinations must not overlap');
  }
}
if (contains(staging, output) || contains(output, staging)) throw new Error('Staging and output must not overlap');
const hash = value => createHash('sha256').update(value).digest('hex');
const sourceAsar = join(official, 'resources', 'app.asar');
const sourceHash = hash(await readFile(sourceAsar));
if (sourceHash !== '708229949f0533d6d69fca3d4d72c3ad6814fda484ea3b0a7af96b71e83a6126') throw new Error('Unreviewed official RC2 resource archive');
const manifest = JSON.parse(await readFile(join(desktop, 'package.json'), 'utf8'));
if (manifest.version !== '0.1.7-rc.2') throw new Error('This internal sample requires the reviewed RC2 shell');
const builtMain = await readFile(join(desktop, 'lib', 'main.js'));
if (!builtMain.includes(Buffer.from('DSH_PORTABLE_DEVELOPMENT_ROOT'))) throw new Error('Portable path adapter was not compiled');
const require = createRequire(await realpath(join(desktop, 'node_modules', 'electron-builder', 'package.json')));
const asar = createRequire(require.resolve('app-builder-lib'))('@electron/asar');
// Both destinations must be fresh. Never consume or overwrite a user's existing installation.
await mkdir(staging);
await mkdir(output);
asar.extractAll(sourceAsar, staging);
const unpackPackages = new Set();
function collectUnpacked(node, prefix = '') {
  for (const [entry, child] of Object.entries(node.files ?? {})) {
    const name = prefix ? `${prefix}/${entry}` : entry;
    if (child.files) collectUnpacked(child, name);
    else if (child.unpacked) {
      const parts = name.split('/');
      if (!name.startsWith('dsh/node_modules/')) throw new Error(`Unexpected unpacked resource: ${name}`);
      unpackPackages.add(parts.slice(0, parts[2].startsWith('@') ? 4 : 3).join('/'));
    }
  }
}
collectUnpacked(asar.getRawHeader(sourceAsar).header);
for (const entry of await readdir(electron, { withFileTypes: true })) {
  if (entry.name === 'resources') continue;
  await cp(join(electron, entry.name), join(output, entry.name), { recursive: entry.isDirectory(), errorOnExist: true, force: false });
}
await rename(join(output, 'electron.exe'), join(output, 'DSH-Portable-Alpha.exe'));
await mkdir(join(output, 'resources'));
await cp(join(official, 'resources', 'runtime'), join(output, 'resources', 'runtime'), { recursive: true });
for (const name of ['icon.png', 'tray.ico']) await cp(join(official, 'resources', name), join(output, 'resources', name));
await writeFile(join(staging, 'lib', 'main.js'), builtMain);
for (const entry of await readdir(join(desktop, 'lib'), { withFileTypes: true })) {
  if (entry.name.endsWith('.cjs') || entry.name === 'welcome') await cp(join(desktop, 'lib', entry.name), join(staging, 'lib', entry.name), { recursive: entry.isDirectory() });
}
const packagePath = join(staging, 'package.json');
const appManifest = JSON.parse(await readFile(packagePath, 'utf8'));
const development = JSON.parse(await readFile(new URL('./development-channel.json', import.meta.url), 'utf8'));
appManifest.productName = `DSH-Portable ${development.version}`;
appManifest.dshPortableDevelopment = development;
delete appManifest.dshMandatoryUpdatePolicy;
await writeFile(packagePath, JSON.stringify(appManifest, null, 2));
await asar.createPackageWithOptions(staging, join(output, 'resources', 'app.asar'), {
  unpackDir: `{${[...unpackPackages].sort().join(',')}}`,
});
const evidence = { ...development, coreVersion: manifest.version, sourceArchiveSha256: sourceHash,
  compiledMainSha256: hash(builtMain), appArchiveSha256: hash(await readFile(join(output, 'resources', 'app.asar'))),
  executableSha256: hash(await readFile(join(output, 'DSH-Portable-Alpha.exe'))),
  buildIdentity: 'community-development', acceptance: 'pending', publicRelease: false };
await writeFile(join(output, 'development.json'), JSON.stringify(evidence, null, 2) + '\n');
await writeFile(join(output, 'README.txt'), `DSH-Portable ${development.version} — 内部开发版\r\n\r\n双击 DSH-Portable-Alpha.exe。数据保存在本目录 data 下，移动时请先退出整个应用。\r\n这是独立社区实验构建，内核与桌面代码基于官方 ${manifest.version}；不是官方签名发行版。\r\n公开更新已关闭。不导入原有重要数据；旧会话迁移与完整更新恢复仍未完成。\r\n模型权重不随包提供；账号登录和联网模型仍需要网络。\r\n\r\n验收结果见同目录的验收说明；development.json 记录程序来源及摘要。\r\n`);
console.log(JSON.stringify({ output, ...evidence }));
