import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { layoutForRoot } from './launcher/portable-core.mjs'
import { ensureRuntimeCapsule } from './launcher/runtime-capsule.mjs'
import {
  copyVerifiedLocalComponent, installAvailableAppUpdate, listEngineVersions,
  prepareOfflineUpdateFiles, readInstalledUpdateState, readLocalUpdate,
} from './launcher/update-core.mjs'

// Embedded in the Windows updater. Node runs this with the verified package as its working directory.
const root = process.cwd()
const state = process.env.DSH_PORTABLE_STAGE_STATE
const version = process.env.DSH_PORTABLE_STAGE_CORE
if (!state || !version) throw new Error('Missing Portable core staging inputs.')

const installed = await readInstalledUpdateState({ root })
const capsule = installed.runtimeLayout === 'capsule-v1'
const layout = layoutForRoot(root, process.platform, state, capsule ? path.join(state, 'runtime') : root)
const { versions } = await listEngineVersions({ layout })
const entry = versions.find(item => item.version === version && item.status === 'available')
if (!entry) throw new Error('The current core is not qualified for this Portable package.')
const saved = await prepareOfflineUpdateFiles({ layout, output: state, scope: 'engine', manifestUrl: entry.manifestUrl })
if (saved.status !== 'saved' || saved.version !== version) throw new Error('The signed core package does not match the selected version.')
const update = await readLocalUpdate({ layout, input: saved.files.manifest, scope: 'engine' })
if (update.status !== 'available' || update.component.dshVersion !== version) throw new Error('The signed core package is incompatible.')
await installAvailableAppUpdate({
  layout, update,
  download: options => copyVerifiedLocalComponent({ ...options, source: update.localArchive }),
  healthCheck: async () => {
    const runtimeRoot = capsule ? (await ensureRuntimeCapsule(root)).runtimeRoot : root
    const { dshBin } = layoutForRoot(root, process.platform, state, runtimeRoot)
    const { stdout } = await promisify(execFile)(process.execPath, [dshBin, '--version'], { windowsHide: true, timeout: 15000 })
    return stdout.trim() === version
  },
})
