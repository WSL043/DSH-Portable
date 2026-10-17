// The official experimental plugin market (0.2.1+) installs only from an npm registry or a pinned git commit. A large
// part of the Awesome DSH catalog ships as a GitHub release tarball whose build output is not in the repository, so a
// git source would install source without its built files. This adds a third index source type,
//   { "type": "tarball", "url": "https://.../name-1.2.3.tgz" }
// that installs exactly that URL, shows it as the origin, and is otherwise validated like the other sources.
// Cores that do not ship the market packages (0.2.0-rc.2) are left untouched.
import { access, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const MARKER = 'dsh-portable-market-tarball-v1'

const SOURCE_DEFAULT = 'default: return fail(`${path}.type`, "must be \\"npm\\" or \\"git\\"");'
const SOURCE_TARBALL = [
  'case "tarball": {',
  '\t\t\tconst tarballUrl = httpUrl(object.url, `${path}.url`, ["https:"]);',
  '\t\t\tif (tarballUrl.href !== object.url) fail(`${path}.url`, "must be a canonical URL");',
  '\t\t\tif (!/\\.(?:tgz|tar\\.gz)$/iu.test(tarballUrl.pathname)) fail(`${path}.url`, "must name a .tgz or .tar.gz tarball");',
  '\t\t\treturn { type: "tarball", url: tarballUrl.href };',
  '\t\t}',
  `\t\t/* ${MARKER} */`,
  '\t\tdefault: return fail(`${path}.type`, "must be \\"npm\\", \\"git\\" or \\"tarball\\"");',
].join('\n')

const TARGET_ANCHOR = 'return { spec: `git+${from.url.endsWith(".git")'
const TARGET_TARBALL = `if (from.type === "tarball") return { spec: from.url }; /* ${MARKER} */\n\t`

const FACTS_ANCHOR = /(function sourceFacts\(name, version\) \{\s*const \{ source \} = version;)/u

function replaceOnce(source, original, replacement, label) {
  const matches = source.split(original).length - 1
  if (matches !== 1) throw new Error(`Official market ${label} seam changed: expected 1 match, found ${matches}`)
  return source.replace(original, () => replacement)
}

export function patchMarketIndex(source) {
  if (source.includes(MARKER)) return source
  const withSource = replaceOnce(source, SOURCE_DEFAULT, SOURCE_TARBALL, 'index source')
  return replaceOnce(withSource, TARGET_ANCHOR, TARGET_TARBALL + TARGET_ANCHOR, 'install target')
}

export function patchMarketClient(source) {
  if (source.includes(MARKER)) return source
  const matches = source.match(new RegExp(FACTS_ANCHOR.source, 'gu'))?.length ?? 0
  if (matches !== 1) throw new Error(`Official market client source-facts seam changed: expected 1 match, found ${matches}`)
  return source.replace(FACTS_ANCHOR, (head) => `${head}\n\t\t\tif (source.type === "tarball") return [{ kind: "repository", value: source.url }]; /* ${MARKER} */`)
}

async function exists(filename) {
  return access(filename).then(() => true, () => false)
}

export async function patchOfficialMarket(appRoot) {
  const scope = path.join(appRoot, 'node_modules', '@deepseek-ai')
  const indexFile = path.join(scope, 'dsh-plugin-market-index', 'lib', 'index.js')
  const clientFile = path.join(scope, 'dsh-client-ui-plugin-market', 'lib', 'client.js')
  const present = [await exists(indexFile), await exists(clientFile)]
  if (!present[0] && !present[1]) return { applied: false, reason: 'core-has-no-plugin-market' }
  if (present[0] !== present[1]) throw new Error('Official plugin market packages are only partly present; refusing to patch half of them')
  const patched = []
  for (const [filename, patch] of [[indexFile, patchMarketIndex], [clientFile, patchMarketClient]]) {
    const source = await readFile(filename, 'utf8')
    const next = patch(source)
    if (next !== source) await writeFile(filename, next, 'utf8')
    patched.push(filename)
  }
  return { applied: true, files: patched }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('usage: node patch-official-market-tarball.mjs <app root>')
  console.log(JSON.stringify(await patchOfficialMarket(path.resolve(process.argv[2]))))
}
