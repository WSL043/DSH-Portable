import { join } from 'node:path'
import { loadRegistry, readRegistrySnapshot, revalidateRegistry } from '../registry.ts'
import { getDownloadTotal } from '../download-totals.ts'
import { sendJson } from '../http.ts'

export const name = 'portable-market'
export const inject = ['webServer', 'profileContext']

// Discovery is read-only. All profile mutations belong to the official remote
// pluginManager service; this entry deliberately does not import legacy routes.
export function apply(ctx: any): void {
  const cacheFile = join(ctx.profileContext.dir, '.portable-market', 'catalog.json')
  for (const path of ['/dsh-market/registry', '/dsh-market/download-total']) {
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path,
      handler: async (request: any, response: any) => {
        if (request.method !== 'GET') { response.writeHead(405, { allow: 'GET' }); response.end(); return }
        try {
          const url = new URL(request.url, 'http://localhost')
          if (path.endsWith('/download-total')) {
            const name = url.searchParams.get('name') ?? ''
            if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name)) { sendJson(response, 400, { error: 'Invalid package name' }); return }
            sendJson(response, 200, await getDownloadTotal(name)); return
          }
          if (url.searchParams.get('mode') === 'refresh') {
            sendJson(response, 200, await revalidateRegistry({ cacheFile })); return
          }
          const cached = await readRegistrySnapshot(cacheFile)
          sendJson(response, 200, cached ?? { registry: await loadRegistry({ cacheFile }) })
        } catch (error) { sendJson(response, 502, { error: error instanceof Error ? error.message : String(error) }) }
      },
    }), `portable-market: ${path}`)
  }
}
