import {
  createFileExtensionState,
  loadBundledCatalog,
  registerExtensionRoutes,
} from './extensions.js'

export const name = 'dsh-portable-desktop-bridge'
export const inject = ['webServer']

const catalog = await loadBundledCatalog()

export function apply(ctx) {
  const state = createFileExtensionState(process.env)
  const components = {
    portableVersion: String(process.env.DSH_PORTABLE_VERSION ?? ''),
    dshVersion: String(process.env.DSH_PORTABLE_DSH_VERSION ?? ''),
    dshCommit: String(process.env.DSH_PORTABLE_DSH_COMMIT ?? ''),
  }
  ctx.effect(() => registerExtensionRoutes(ctx, { catalog, components, ...state }), 'dsh-portable: extension routes')
}
