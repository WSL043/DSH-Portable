import path from 'node:path'

export function defaultBrowserSpec(value, platform = process.platform, environment = process.env) {
  const url = new URL(value)
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.username || url.password) throw new Error('Expected a local Portable workspace URL')
  if (platform === 'win32') return {
    command: path.win32.join(environment.SystemRoot || environment.WINDIR || 'C:\\Windows', 'explorer.exe'),
    args: [url.href],
  }
  return { command: platform === 'darwin' ? '/usr/bin/open' : 'xdg-open', args: [url.href] }
}
