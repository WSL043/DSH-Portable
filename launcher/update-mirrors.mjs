// Public GitHub proxies that serve release assets, for users who cannot reach github.com directly. They are only
// fallbacks: GitHub is always tried first, metadata from a mirror must be signed (update-signature.mjs) and every
// archive is checked against the digest in that signed metadata, so a mirror can fail but cannot change what is installed.
// DSH_PORTABLE_UPDATE_MIRRORS overrides the list (comma-separated URL prefixes) or turns mirrors off with "off".
export const DEFAULT_UPDATE_MIRRORS = [
  'https://gh-proxy.com/',
  'https://ghfast.top/',
  'https://ghproxy.net/',
  'https://gh.llkk.cc/',
]

const RELEASE_ASSET = /^\/WSL043\/DSH-Portable(?:-Updates)?\/releases\/download\/[^/]+\/[^/]+$/

export function configuredMirrors(env = process.env) {
  const value = String(env.DSH_PORTABLE_UPDATE_MIRRORS ?? '').trim()
  if (/^(off|none|0|false)$/i.test(value)) return []
  if (!value) return DEFAULT_UPDATE_MIRRORS
  return value.split(',').map(item => item.trim()).filter(item => /^https:\/\/[^/\s]+\/?/.test(item)).map(item => (item.endsWith('/') ? item : `${item}/`))
}

// Mirror routes for one GitHub release-asset URL; anything else (other hosts, other repositories) has no mirror.
export function mirrorUrls(urlValue, mirrors = configuredMirrors()) {
  let url
  try { url = new URL(urlValue) } catch { return [] }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || !RELEASE_ASSET.test(url.pathname)) return []
  url.searchParams.delete('_portable_check')
  const origin = `${url.origin}${url.pathname}${url.search}`
  return mirrors.map(prefix => `${prefix}${origin}`)
}
