import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const profiles = {
  alpha2: {
    commit: 'ddefc45fbc7f8e46dd73185e68295696d1297887',
    hashes: {
      'main.ts': '39d59be63ba2e5d23d7db69ab245283f99e7364cc967fa5b9d039c9081c559c0',
      'update-coordinator.ts': '7ad2eee74635e6a6cd55ff539d0bcd6735f8dad117522bbe577be6a53b1ad46d',
    },
  },
  rc2: {
    commit: '477b4f420553e8a52c2fbccc464d7561b239c443',
    hashes: {
      'main.ts': '3b32d5f52f8e501f2ed1db51f2f72dae06e676a04196a6d4c4f96f375cbf15e5',
      'update-coordinator.ts': '7ad2eee74635e6a6cd55ff539d0bcd6735f8dad117522bbe577be6a53b1ad46d',
      'dev.ts': 'a48bc690d066d30ad68057e47b1af64b167694d34d0c8e1c735ea68a85a7095c',
    },
  },
};
export const commit = profiles.alpha2.commit;
function reviewedProfile(name) {
  if (!Object.hasOwn(profiles, name)) throw new Error(`Unknown official desktop profile: ${name}`);
  return profiles[name];
}
const sha = value => createHash('sha256').update(value).digest('hex');
function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) throw new Error('Reviewed desktop source shape changed');
  return source.replace(before, after);
}
export function adaptDevelopmentSource(name, input, profileName = 'alpha2') {
  const profile = reviewedProfile(profileName);
  if (sha(input) !== profile.hashes[name]) throw new Error(`Unreviewed official desktop source: ${name}`);
  let source = input.toString();
  if (name === 'main.ts') {
    source = replaceOnce(source, "let focusPrimaryWindow = (): void => {}", "import { configureDevelopmentPaths } from './portable-development.ts'\nconfigureDevelopmentPaths(app)\n\nlet focusPrimaryWindow = (): void => {}");
    source = replaceOnce(source,
      "  const developmentPolicy = app.isPackaged ? undefined : process.env.DSH_DESKTOP_MANDATORY_UPDATE_CONFIG\n  const policyInput: unknown = app.isPackaged\n    ? ('dshMandatoryUpdatePolicy' in manifest ? manifest.dshMandatoryUpdatePolicy : undefined)\n    : developmentPolicy === undefined ? undefined : JSON.parse(developmentPolicy) as unknown\n  const policyConfig = resolveDesktopPolicyConfig(policyInput, !app.isPackaged)",
      "  // Portable development has no official installer or mandatory-update owner.\n  const policyConfig = resolveDesktopPolicyConfig(undefined, !app.isPackaged)");
  } else if (name === 'update-coordinator.ts') {
    source = replaceOnce(source, "import { existsSync } from 'node:fs'\nimport { join } from 'node:path'\n", '');
    source = replaceOnce(source, "private readonly enabled: () => boolean = () => app.isPackaged && existsSync(join(process.resourcesPath, 'app-update.yml')),", "private readonly enabled: () => boolean = () => false, // Portable development: never run the official installer.");
  } else if (name === 'dev.ts') {
    source = replaceOnce(source,
      "const { values } = parseArgs({ options: { 'skip-build': { type: 'boolean', default: false } } })",
      "const { values } = parseArgs({ options: { 'skip-build': { type: 'boolean', default: false }, 'prepare-only': { type: 'boolean', default: false } } })");
    source = replaceOnce(source, '  await preparePrimaryRuntime()\n  await launchElectron()',
      "  await preparePrimaryRuntime()\n  if (values['prepare-only']) return\n  await launchElectron()");
  }
  return source;
}

// Produces reviewed source overlays; does not edit a signed bundle or an existing checkout.
export async function prepareDevelopment(inputs, output, profileName = 'alpha2') {
  const profile = reviewedProfile(profileName);
  try {
    if ((await readdir(output)).length) throw new Error('Development overlay output must be empty');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const files = {};
  for (const name of Object.keys(profile.hashes)) files[name] = adaptDevelopmentSource(name, await readFile(join(inputs, name)), profileName);
  const helper = await readFile(new URL('./development-paths.mjs', import.meta.url), 'utf8');
  files['portable-development.ts'] = helper
    .replace("import { mkdirSync }", "import type { App } from 'electron';\nimport { mkdirSync }")
    .replace('configureDevelopmentPaths(app, env = process.env)', 'configureDevelopmentPaths(app: App, env: NodeJS.ProcessEnv = process.env)')
    .replace('app.setPath(name, path)', 'app.setPath(name as "userData" | "sessionData" | "logs" | "crashDumps", path)');
  await mkdir(output, { recursive: true });
  for (const [name, source] of Object.entries(files)) await writeFile(join(output, name), source);
  const report = { commit: profile.commit, channel: 'development-only', qualified: false,
    inputs: profile.hashes, outputs: Object.fromEntries(Object.entries(files).map(([name, source]) => [name, sha(source)])),
    limits: ['Not a distributable product', 'Full host and plugin acceptance pending', 'Cross-machine encrypted state not qualified'] };
  await writeFile(join(output, 'provenance.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length < 4 || process.argv.length > 5) throw new Error('Usage: node prepare-development.mjs <reviewed-source-directory> <new-output-directory> [alpha2|rc2]');
  console.log(JSON.stringify(await prepareDevelopment(resolve(process.argv[2]), resolve(process.argv[3]), process.argv[4] ?? 'alpha2'), null, 2));
}
