import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isUpgrade } from './updates.ts'

/** Only the two reviewed defaults follow the installed Portable baseline. */
export function bundledUpdateTarget(name: string, current: string | null, root = process.env.DSH_PORTABLE_ROOT): string | null {
  if (!root || !['dsh-chat-manager', 'dsh-image-viewer'].includes(name)) return null
  try {
    const metadata = JSON.parse(readFileSync(join(root, 'licenses', 'COMPONENTS.json'), 'utf8'))
    const item = metadata.defaultPlugins?.find((entry: { package: string }) => entry.package === name)
    const version = item?.version
    return typeof version === 'string' && /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version) && current !== null && isUpgrade(current, version) ? version : null
  } catch { return null }
}
