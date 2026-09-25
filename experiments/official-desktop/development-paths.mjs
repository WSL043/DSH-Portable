import { lstatSync, mkdirSync } from 'node:fs';
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
  // Check all existing ancestors before creating anything or changing Electron state.
  // This is accidental-redirection protection, not a sandbox against concurrent local writers.
  for (const path of directories) assertUnredirectedDirectory(path);
  for (const path of directories) mkdirSync(path, { recursive: true });
  env.DSH_HOME = join(data, 'dsh-home');
  for (const [name, path] of Object.entries(paths)) app.setPath(name, path);
  app.setAppLogsPath(paths.logs);
  env.DSH_DESKTOP_UPDATE_JOURNAL_DIR = join(paths.logs, 'desktop-update');
  return { root, home: env.DSH_HOME, ...paths };
}
