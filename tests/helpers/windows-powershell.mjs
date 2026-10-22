// Environment values may select a known system installation, but cannot become
// an executable path. Keep the accepted paths independent of environment input.
export function windowsPowerShell() {
  const systemRoot = process.env.SystemRoot?.replaceAll('\\', '/').toLowerCase();
  for (const drive of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    const root = `${drive}:/Windows`;
    if (systemRoot === root.toLowerCase()) {
      return `${root}/System32/WindowsPowerShell/v1.0/powershell.exe`;
    }
  }
  throw new Error('Windows acceptance tests require a drive-root Windows installation');
}
