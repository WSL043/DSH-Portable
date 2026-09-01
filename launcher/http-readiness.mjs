import http from 'node:http'

const MAX_WORKSPACE_DOCUMENT_BYTES = 2 * 1024 * 1024

export function officialWorkspaceUrl(output, expectedPort) {
  const matches = String(output ?? '').matchAll(/dsh web:\s+(https?:\/\/[^\s]+)/g)
  let result = null
  for (const match of matches) {
    try {
      const candidate = new URL(match[1])
      const port = Number(candidate.port || (candidate.protocol === 'http:' ? 80 : 443))
      if (candidate.protocol !== 'http:' || candidate.hostname !== '127.0.0.1' || port !== Number(expectedPort)) continue
      result = candidate.href
    } catch { /* ignore incomplete log lines */ }
  }
  return result
}

function requestTarget(target, options = {}) {
  if (Number.isSafeInteger(Number(target))) {
    return { hostname: '127.0.0.1', port: Number(target), path: '/' }
  }
  try {
    const url = new URL(String(target))
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') return null
    return {
      hostname: url.hostname,
      port: Number(url.port || 80),
      path: options.preserveAccessToken ? (url.pathname || '/') : `${url.pathname}${url.search}`,
    }
  } catch {
    return null
  }
}

function redirectedTarget(current, location) {
  try {
    const origin = `http://${current.hostname}:${current.port}`
    const next = new URL(String(location), `${origin}${current.path}`)
    const port = Number(next.port || 80)
    if (next.protocol !== 'http:' || next.hostname !== current.hostname || port !== Number(current.port)) return null
    return { hostname: current.hostname, port, path: `${next.pathname}${next.search}` }
  } catch {
    return null
  }
}

function responseCookieHeader(setCookie) {
  const fields = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : []
  return fields
    .map(value => String(value).split(';', 1)[0].trim())
    .filter(value => /^[^=;\s]+=[^;]*$/.test(value))
    .join('; ')
}

export function workspaceDocumentReady(target, timeout = 1200, options = {}) {
  return new Promise((resolve) => {
    const requestOptions = requestTarget(target, options)
    if (!requestOptions) {
      resolve(false)
      return
    }
    let settled = false
    const finish = (ready) => {
      if (settled) return
      settled = true
      resolve(Boolean(ready))
    }
    const inspect = (current, redirects = 0, cookie = '') => {
      const request = http.get({ ...current, timeout, headers: cookie ? { cookie } : undefined }, (response) => {
      const status = Number(response.statusCode)
      if ([301, 302, 303, 307, 308].includes(status) && redirects < 2) {
        const next = redirectedTarget(current, response.headers.location)
        const nextCookie = responseCookieHeader(response.headers['set-cookie']) || cookie
        response.resume()
        response.once('end', () => next ? inspect(next, redirects + 1, nextCookie) : finish(false))
        response.once('aborted', () => finish(false))
        response.once('error', () => finish(false))
        return
      }
      const contentType = String(response.headers['content-type'] || '').toLowerCase()
      let length = 0
      response.on('data', (chunk) => {
        length += chunk.length
        if (length > MAX_WORKSPACE_DOCUMENT_BYTES) request.destroy(new Error('workspace document is too large'))
      })
      response.once('end', () => finish(
        options.preserveAccessToken
          ? status >= 200 && status < 500
          : status === 200
          && contentType.startsWith('text/html')
          && length > 0
          && length <= MAX_WORKSPACE_DOCUMENT_BYTES,
      ))
      response.once('aborted', () => finish(false))
      response.once('error', () => finish(false))
      })
      request.once('timeout', () => request.destroy(new Error('workspace document timed out')))
      request.once('error', () => finish(false))
    }
    inspect(requestOptions)
  })
}
