import { readFile, writeFile, rename, cp, mkdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const names = ['dsh-chat-manager', '@wsl043/dsh-portable-plugin-market'];
export async function isFreshProfile(profile) {
  try {await readFile(join(profile,'package.json'));return false;} catch(error) {if(error.code==='ENOENT')return true;throw error;}
}
export async function seedDefaults(root, profile, executable, resources, fresh = false) {
  if (resolve(profile).toLowerCase() !== resolve(root, 'data/dsh-home/profiles/desktop').toLowerCase()) throw Error('Default plugin profile boundary changed');
  const marker = join(root, 'data/launcher/default-plugins.json');
  let pending=false;
  try {
    const previous=JSON.parse(await readFile(marker,'utf8'));
    if(previous.schemaVersion!==1)throw Error('Unsupported default plugin state');
    if(previous.status!=='pending')return;
    pending=true;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if(!fresh&&!pending){await writeFile(marker,JSON.stringify({schemaVersion:1,status:'existing-profile-preserved'}));return;}
  const manifestPath = join(profile, 'package.json');
  const original = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(original);
  // A user-managed profile is never repopulated. Removing/disabling defaults
  // after initialization must remain effective on restart and update.
  if (Object.keys(manifest.dependencies ?? {}).some(name => !names.includes(name))) {
    await writeFile(marker, JSON.stringify({schemaVersion:1, status:'existing-profile-preserved'})); return;
  }
  await writeFile(marker,JSON.stringify({schemaVersion:1,status:'pending'}));
  const defaults = join(root, 'launcher/default-plugins');
  const store = join(root, 'data/pnpm-store');
  await mkdir(store, {recursive:true});
  await cp(join(defaults, 'store'), store, {recursive:true, force:false, errorOnExist:false});
  await cp(join(defaults, 'cache'), join(root,'data/pnpm-cache'), {recursive:true, force:false, errorOnExist:false});
  // Keep the published chat plugin as an npm source so the official manager
  // can discover later releases. Only the unpublished alpha market is local.
  const specs = ['dsh-chat-manager@1.5.2', 'file:' + relative(profile, join(defaults, 'dsh-portable-plugin-market')).replaceAll('\\', '/')];
  const args = [join(resources, 'runtime/pnpm/bin/pnpm.mjs'), 'add', ...specs, '--offline', '--ignore-scripts', '--store-dir', store, '--config.auto-install-peers=false'];
  let diagnostic = '';
  const child = spawn(executable, args, {cwd:profile, windowsHide:true, env:{...process.env, ELECTRON_RUN_AS_NODE:'1', CI:'true'}, stdio:['ignore','pipe','pipe'], timeout:90000});
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { diagnostic = (diagnostic + chunk).slice(-12000); });
  await new Promise((accept, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? accept() : reject(Error(`Default plugin initialization failed (${code}): ${diagnostic}`))); });
  const installed = JSON.parse(await readFile(manifestPath, 'utf8'));
  for (const name of names) if (!installed.dependencies?.[name]) throw Error(`Default plugin missing: ${name}`);
  const bundles = installed.dsh?.profile?.bundles;
  if (!Array.isArray(bundles)) throw Error('Official profile bundle contract changed');
  installed.dsh.profile.bundles = [...new Set([...bundles, ...names])];
  const temporary = manifestPath + '.portable-defaults.tmp';
  await writeFile(temporary, JSON.stringify(installed, null, 2) + '\n');
  await rename(temporary, manifestPath);
  await writeFile(marker, JSON.stringify({schemaVersion:1, status:'initialized', packages:names}));
}
