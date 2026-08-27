/** Ambient declarations for the browser client bundle. */

declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}

interface Window {
  /** Boot manifest written by the host page for bundle-layer plugins. */
  __DSH_BOOT__?: {
    entries?: Array<{ id: string }>
  }
  /** Native Portable host capabilities injected by the desktop bridge. */
  __DSH_PORTABLE_HOST__?: {
    restart: () => Promise<{ ok: true }>
  }
}
