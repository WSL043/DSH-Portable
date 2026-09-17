import { mkdirSync } from 'node:fs';
import { isAbsolute, join, parse, resolve } from 'node:path';

// Development builds require an explicit, separate root. Never default to ~/.dsh.
export function configureDevelopmentPaths(app, env = process.env) {
  const supplied = env.DSH_PORTABLE_DEVELOPMENT_ROOT;
  if (!supplied || !isAbsolute(supplied)) throw new Error('An absolute DSH_PORTABLE_DEVELOPMENT_ROOT is required');
  const root = resolve(supplied);
  if (root === parse(root).root) throw new Error('The development root cannot be a filesystem root');
  if (app.isReady()) throw new Error('Portable paths must be configured before Electron is ready');
  const data = join(root, 'data');
  const paths = {
    userData: join(data, 'electron'), sessionData: join(data, 'electron'),
    logs: join(data, 'logs'), crashDumps: join(data, 'crash-dumps'),
  };
  for (const path of new Set([...Object.values(paths), join(data, 'dsh-home')])) mkdirSync(path, { recursive: true });
  env.DSH_HOME = join(data, 'dsh-home');
  for (const [name, path] of Object.entries(paths)) app.setPath(name, path);
  app.setAppLogsPath(paths.logs);
  env.DSH_DESKTOP_UPDATE_JOURNAL_DIR = join(paths.logs, 'desktop-update');
  return { root, home: env.DSH_HOME, ...paths };
}
