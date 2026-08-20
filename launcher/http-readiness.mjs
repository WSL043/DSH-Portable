import http from 'node:http'

const MAX_WORKSPACE_DOCUMENT_BYTES = 2 * 1024 * 1024

export function workspaceDocumentReady(port, timeout = 1200) {
  return new Promise((resolve) => {
    let settled = false
    const finish = (ready) => {
      if (settled) return
      settled = true
      resolve(Boolean(ready))
    }
    const request = http.get({ hostname: '127.0.0.1', port, path: '/', timeout }, (response) => {
      const status = Number(response.statusCode)
      const contentType = String(response.headers['content-type'] || '').toLowerCase()
      let length = 0
      response.on('data', (chunk) => {
        length += chunk.length
        if (length > MAX_WORKSPACE_DOCUMENT_BYTES) request.destroy(new Error('workspace document is too large'))
      })
      response.once('end', () => finish(
        status === 200
          && contentType.startsWith('text/html')
          && length > 0
          && length <= MAX_WORKSPACE_DOCUMENT_BYTES,
      ))
      response.once('aborted', () => finish(false))
      response.once('error', () => finish(false))
    })
    request.once('timeout', () => request.destroy(new Error('workspace document timed out')))
    request.once('error', () => finish(false))
  })
}
