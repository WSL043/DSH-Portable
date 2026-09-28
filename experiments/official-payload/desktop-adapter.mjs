import { app } from 'electron';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PortableUpdater } from './update-bridge.mjs';
import { seedDefaults, isFreshProfile } from './default-plugins.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const launcher = join(root, 'DeepSeek Harness Portable.exe');
// Direct internal EXE/protocol starts must enter the same validated launcher path.
// This module is evaluated before the official main module's other dependencies.
if (process.env.DSH_PORTABLE_ROOT?.toLowerCase() !== root.toLowerCase()) {
  const links = process.argv.filter(value => /^dsh:\/\//i.test(value));
  const child = spawn(launcher, links.slice(0, 1), {detached: true, stdio: 'ignore', windowsHide: true});
  child.once('error', () => app.exit(1));
  child.once('spawn', () => { child.unref(); app.exit(0); });
  // Prevent the official startup module from acquiring a different profile lock.
  await new Promise(() => {});
}
export function configurePortableProtocol(application) {
  if (!application.setAsDefaultProtocolClient('dsh', launcher)) console.error('Portable protocol registration failed');
}
export const portableProfileIsFresh = isFreshProfile;
export const seedPortableDefaults = (profile, fresh) => seedDefaults(root, profile, process.execPath, process.resourcesPath, fresh);
export function portableCoordinator(OfficialCoordinator, application) {
  return class extends OfficialCoordinator {
    constructor(publish, beforeRestart) {
      super(publish, beforeRestart, new PortableUpdater(root, application), () => true);
    }
  };
}
