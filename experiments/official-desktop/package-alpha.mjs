// Windows clean-install alpha: reviewed runtime + compiled community shell.
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
const builtHost = await readFile(join(desktop, '..', 'desktop-host', 'lib', 'index.js'));
if (!/args:\s*\[\s*"--no-open",\s*"--port",\s*"0"\s*\]/.test(builtHost.toString())) throw new Error('Portable ephemeral-port host adapter was not compiled');
const require = createRequire(await realpath(join(desktop, 'node_modules', 'electron-builder', 'package.json')));
const asar = createRequire(require.resolve('app-builder-lib'))('@electron/asar');
// Both destinations must be fresh. Never consume or overwrite a user's existing installation.
await mkdir(staging);
await mkdir(output);
asar.extractAll(sourceAsar, staging);
const descriptorPath = join(staging, 'dsh', 'desktop-runtime.json');
const descriptor = JSON.parse(await readFile(descriptorPath));
const hostPath = 'node_modules/@deepseek-ai/dsh-desktop-host/lib/index.js';
const hostRecord = descriptor.files.find(file => file.path === hostPath);
if (!hostRecord || hostRecord.sha256 !== hash(await readFile(join(staging, 'dsh', hostPath)))) throw new Error('Original Desktop host does not match its runtime descriptor');
await writeFile(join(staging, 'dsh', hostPath), builtHost);
hostRecord.sha256 = hash(builtHost);
hostRecord.bytes = builtHost.length;
await writeFile(descriptorPath, JSON.stringify(descriptor, null, 2) + '\n');
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
  compiledMainSha256: hash(builtMain), compiledHostSha256: hash(builtHost), hostAdaptation: 'OS-assigned loopback port', appArchiveSha256: hash(await readFile(join(output, 'resources', 'app.asar'))),
  executableSha256: hash(await readFile(join(output, 'DSH-Portable-Alpha.exe'))),
  buildIdentity: 'community-development', acceptance: 'requires-release-qualification', publicRelease: development.publicRelease };
await writeFile(join(output, 'development.json'), JSON.stringify(evidence, null, 2) + '\n');
await writeFile(join(output, 'README.txt'), `DSH-Portable ${development.version} — Windows x64 Alpha\r\n\r\n解压到全新文件夹，双击 DSH-Portable-Alpha.exe。未配置账号时可选“稍后配置”。\r\n不要覆盖旧 Portable，也不要复制旧 data：本 Alpha 不支持旧数据迁移。\r\n数据保存在本目录 data 下；搬动文件夹前请从“应用”菜单退出整个程序。\r\n这是独立社区实验构建，内核与桌面代码基于官方 ${manifest.version}；不是官方签名发行版。\r\n自动更新关闭：后续版本请按对应发行说明手动安装，勿运行官方安装器覆盖本目录。\r\n未承诺跨机器保留登录态，换机器可能需重新登录。模型权重不随包提供，联网服务仍需要网络。\r\n使用官方插件页面；原 Native 版的 Portable 增强、完整更新恢复、存储清理和体积优化尚在开发。\r\n账号登录、默认插件完整功能和跨机器场景未完成验收。不要用于唯一一份重要数据。\r\n\r\nExtract into a NEW folder. Do not overwrite an older Portable installation or import its data.\r\nCommunity alpha; automatic updates and legacy migration are not supported.\r\n\r\n验收范围与已知限制见发行说明。development.json 记录来源摘要。\r\n`);
console.log(JSON.stringify({ output, ...evidence }));
