export function upstreamRequestHeaders(url, token = process.env.GITHUB_TOKEN) {
  const { protocol, hostname } = new URL(url)
  const github = protocol === 'https:' && ['api.github.com', 'raw.githubusercontent.com'].includes(hostname)
  return {
    accept: hostname === 'api.github.com' ? 'application/vnd.github+json' : 'application/json',
    'user-agent': 'DSH-Portable-upstream',
    ...(github && token ? { authorization: `Bearer ${token}` } : {}),
  }
}
