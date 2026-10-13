// Portable's own network requests (update checks, core downloads, plugin installs) follow the proxy the user already
// has: an HTTPS_PROXY-style environment variable first, otherwise the system proxy that browsers use. Node does not
// read the system proxy by itself, so without this a user whose browser works through a proxy sees "update service
// unavailable". Only Portable's maintenance traffic is routed: the host and its model requests keep their own rules.
import { execFileSync } from 'node:child_process'
import http from 'node:http'

const ENV_KEYS = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy']
const LOCAL_BYPASS = ['localhost', '127.0.0.1', '::1', '[::1]']

function hasEnvProxy(env) {
  return ENV_KEYS.some(key => String(env[key] ?? '').trim() !== '')
}

function withScheme(value) {
  const text = String(value ?? '').trim()
  if (!text) return ''
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`
}

// "host:port" or "http=host:port;https=host:port;socks=host:port". SOCKS proxies cannot carry HTTPS fetches here.
export function parseProxyServer(value) {
  const text = String(value ?? '').trim()
  if (!text) return { http: '', https: '' }
  if (!text.includes('=')) {
    const url = withScheme(text)
    return { http: url, https: url }
  }
  const table = {}
  for (const part of text.split(';')) {
    const [scheme, ...rest] = part.split('=')
    if (rest.length) table[scheme.trim().toLowerCase()] = rest.join('=').trim()
  }
  return { http: withScheme(table.http), https: withScheme(table.https || table.http) }
}

function registryValue(output, name) {
  const match = new RegExp(`^\\s*${name}\\s+REG_\\w+\\s+(.*)$`, 'im').exec(output)
  return match ? match[1].trim() : ''
}

export function parseWindowsProxy(output) {
  const enabled = /^0x0*1$|^1$/.test(registryValue(output, 'ProxyEnable'))
  const bypass = registryValue(output, 'ProxyOverride').split(';').map(item => item.trim()).filter(item => item && item !== '<local>')
  return { enabled, ...parseProxyServer(registryValue(output, 'ProxyServer')), bypass }
}

export function parseMacProxy(output) {
  const field = name => new RegExp(`^\\s*${name}\\s*:\\s*(.*)$`, 'm').exec(output)?.[1]?.trim() ?? ''
  const proxy = (flag, host, port, fallbackPort) => (field(flag) === '1' && field(host)
    ? withScheme(`${field(host)}:${field(port) || fallbackPort}`)
    : '')
  const exceptions = [...output.matchAll(/^\s*\d+\s*:\s*(\S+)\s*$/gm)].map(match => match[1])
  return {
    enabled: true,
    http: proxy('HTTPEnable', 'HTTPProxy', 'HTTPPort', '80'),
    https: proxy('HTTPSEnable', 'HTTPSProxy', 'HTTPSPort', '443'),
    bypass: exceptions,
  }
}

function defaultRun(command, args) {
  return execFileSync(command, args, { encoding: 'utf8', timeout: 3000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
}

function readPlatformProxy(platform, run) {
  try {
    if (platform === 'win32') {
      return parseWindowsProxy(run('reg.exe', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings']))
    }
    if (platform === 'darwin') return parseMacProxy(run('scutil', ['--proxy']))
  } catch {
    // An unreadable system setting simply means there is no system proxy to follow.
  }
  return null
}

// The environment Node's proxy support reads. Returns null when the machine uses no proxy.
export function resolveProxyEnvironment({ platform = process.platform, env = process.env, run = defaultRun } = {}) {
  if (hasEnvProxy(env)) return { source: 'environment', env }
  const system = readPlatformProxy(platform, run)
  if (!system?.enabled || (!system.http && !system.https)) return null
  const noProxy = [...new Set([...LOCAL_BYPASS, ...(system.bypass ?? [])])].join(',')
  return {
    source: 'system',
    env: {
      ...(system.https ? { HTTPS_PROXY: system.https } : {}),
      ...(system.http ? { HTTP_PROXY: system.http } : {}),
      NO_PROXY: noProxy,
    },
  }
}

// Route this process's fetch() through the proxy. process.env is not changed, so children and the host are unaffected.
export function installSystemProxy(options = {}) {
  const resolved = resolveProxyEnvironment(options)
  if (!resolved) return { status: 'none' }
  const setGlobalProxy = options.setGlobalProxy ?? http.setGlobalProxyFromEnv
  if (typeof setGlobalProxy !== 'function') return { status: 'unsupported', source: resolved.source }
  const restore = setGlobalProxy(resolved.env)
  return { status: 'installed', source: resolved.source, restore: typeof restore === 'function' ? restore : () => {} }
}

// Variables to add to a child process (pnpm for plugin installs) when the user has not set a proxy there already.
export function proxyEnvOverlay(options = {}) {
  const resolved = resolveProxyEnvironment(options)
  return resolved?.source === 'system' ? resolved.env : {}
}
