import { lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';

function assertUnredirectedDirectory(target) {
  for (let current = target; ; current = dirname(current)) {
    try {
      const stat = lstatSync(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Development storage must be an unredirected directory: ${current}`);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    if (dirname(current) === current) break;
  }
}

// Source launches require an explicit root; standalone samples use the executable
// directory. Neither path falls back to the user's existing ~/.dsh.
export function configureDevelopmentPaths(app, env = process.env) {
  const supplied = env.DSH_PORTABLE_DEVELOPMENT_ROOT
    ?? (app.isPackaged ? dirname(app.getPath('exe')) : undefined);
  if (!supplied || !isAbsolute(supplied)) throw new Error('An absolute DSH_PORTABLE_DEVELOPMENT_ROOT is required');
  const root = resolve(supplied);
  if (root === parse(root).root) throw new Error('The development root cannot be a filesystem root');
  if (app.isReady()) throw new Error('Portable paths must be configured before Electron is ready');
  const data = join(root, 'data');
  const paths = {
    userData: join(data, 'electron'), sessionData: join(data, 'electron'),
    logs: join(data, 'logs'), crashDumps: join(data, 'crash-dumps'),
  };
  const directories = new Set([...Object.values(paths), join(data, 'dsh-home')]);
  directories.add(join(data, 'pnpm-store'));
  // Check all existing ancestors before creating anything or changing Electron state.
  // This is accidental-redirection protection, not a sandbox against concurrent local writers.
  for (const path of directories) assertUnredirectedDirectory(path);
  const marker = join(data, 'portable-alpha.json');
  let hasMarker = false;
  let previousRoot = root;
  try {
    const stat = lstatSync(marker);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Alpha data marker must be a regular file');
    const identity = JSON.parse(readFileSync(marker, 'utf8'));
    if (identity.schemaVersion !== 2 || identity.layout !== 'electron-alpha-clean-install'
      || typeof identity.location !== 'string' || !isAbsolute(identity.location)) throw new Error('Unsupported alpha data layout');
    previousRoot = identity.location;
    hasMarker = true;
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  if (!hasMarker) {
    let entries = [];
    try { entries = readdirSync(data); } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    if (entries.length) throw new Error('此 Alpha 仅支持全新目录，不能直接导入旧版 data。请解压到新文件夹；原数据未修改。 / Extract into a fresh folder; existing data was not changed.');
  }
  // pnpm 11's hoisted layout stores two absolute managed locations. Rebase only
  // those known fields, before the Host starts; never rewrite plugin source specs.
  if (hasMarker && previousRoot !== root) {
    const modulesRoot = join(data, 'dsh-home', 'profiles', 'desktop', 'node_modules');
    assertUnredirectedDirectory(modulesRoot);
    const file = join(modulesRoot, '.modules.yaml');
    try {
      const stat = lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Redirected package-manager metadata');
      const modules = JSON.parse(readFileSync(file, 'utf8'));
      if (modules.packageManager !== 'pnpm@11.7.0' || modules.nodeLinker !== 'hoisted') throw new Error('Unsupported moved plugin layout');
      for (const [key, suffix] of Object.entries({
        storeDir: join('data', 'pnpm-store', 'v11'),
        virtualStoreDir: join('data', 'dsh-home', 'profiles', 'desktop', 'node_modules', '.pnpm'),
      })) {
        if (modules[key] !== join(previousRoot, suffix) && modules[key] !== join(root, suffix)) throw new Error('Plugin dependency location is outside the managed alpha layout');
        modules[key] = join(root, suffix);
      }
      const temporary = `${file}.portable-${process.pid}.tmp`;
      writeFileSync(temporary, JSON.stringify(modules, null, 2) + '\n', { flag: 'wx' });
      renameSync(temporary, file);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
  }
  for (const path of directories) mkdirSync(path, { recursive: true });
  if (!hasMarker || previousRoot !== root) {
    const temporary = `${marker}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify({ schemaVersion: 2, layout: 'electron-alpha-clean-install', location: root }) + '\n', { flag: 'wx' });
    renameSync(temporary, marker);
  }
  env.DSH_HOME = join(data, 'dsh-home');
  for (const key of Object.keys(env)) if (key.toLowerCase() === 'pnpm_config_store_dir') delete env[key];
  env.pnpm_config_store_dir = join(data, 'pnpm-store');
  for (const [name, path] of Object.entries(paths)) app.setPath(name, path);
  app.setAppLogsPath(paths.logs);
  env.DSH_DESKTOP_UPDATE_JOURNAL_DIR = join(paths.logs, 'desktop-update');
  return { root, home: env.DSH_HOME, ...paths };
}
