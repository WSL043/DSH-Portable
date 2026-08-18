import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { classifyProductVersion } from './version-policy.mjs'

const root = path.resolve(import.meta.dirname, '..')
const policy = classifyProductVersion(process.argv[2])
const staged = new Map()

async function stageReplaceMany(filename, replacements) {
  const target = path.join(root, filename)
  const original = await readFile(target, 'utf8')
  let next = original
  for (const [pattern, replacement] of replacements) {
    const source = next
    pattern.lastIndex = 0
    if (!pattern.test(source)) throw new Error(`Version marker was not found in ${filename}.`)
    pattern.lastIndex = 0
    next = source.replace(pattern, replacement)
  }
  staged.set(target, { original, next })
}

const stageReplace = (filename, pattern, replacement) => stageReplaceMany(filename, [[pattern, replacement]])

async function stageJsonVersion(filename, occurrences = 1) {
  const target = path.join(root, filename)
  const original = await readFile(target, 'utf8')
  JSON.parse(original)
  let replaced = 0
  const next = original.replace(/("version"\s*:\s*")[^"]+"/g, (value, prefix) => {
    if (replaced >= occurrences) return value
    replaced += 1
    return `${prefix}${policy.version}"`
  })
  if (replaced !== occurrences) throw new Error(`Expected ${occurrences} product version markers in ${filename}; found ${replaced}.`)
  staged.set(target, { original, next })
}

await Promise.all([
  stageJsonVersion('package.json'),
  stageJsonVersion('desktop-bridge/package.json'),
  stageReplace(
    'app/package-lock.json',
    /("\.\.\/desktop-bridge"\s*:\s*\{[\s\S]*?"version"\s*:\s*")[^"]+/,
    `$1${policy.version}`,
  ),
  stageJsonVersion('launcher/linux/package.json'),
  stageJsonVersion('launcher/linux/package-lock.json', 2),
  stageJsonVersion('launcher/linux/tauri.conf.json'),
  stageReplace('installer/windows/DSH-Portable.iss', /#define AppVersion "[^"]+"([\s\S]*?)VersionInfoVersion=[^\r\n]+/, `#define AppVersion "${policy.version}"$1VersionInfoVersion=${policy.windowsVersion}`),
  stageReplace('installer/windows/DeepSeek-Herness.iss', /#define AppVersion "[^"]+"([\s\S]*?)VersionInfoVersion=[^\r\n]+/, `#define AppVersion "${policy.version}"$1VersionInfoVersion=${policy.windowsVersion}`),
  ...['launcher/windows/DSH-Bootstrap.cs', 'launcher/windows/DSH-Portable.cs', 'launcher/windows/DSH-Command.cs'].map((filename) =>
    stageReplaceMany(filename, [
      [/AssemblyVersion\("[^"]+"\)/, `AssemblyVersion("${policy.windowsVersion}")`],
      [/AssemblyFileVersion\("[^"]+"\)/, `AssemblyFileVersion("${policy.windowsVersion}")`],
    ])),
  stageReplace('launcher/linux/Cargo.toml', /(^name = "deepseek-herness-linux"\r?\nversion = ")[^"]+/m, `$1${policy.version}`),
  stageReplace('launcher/linux/Cargo.lock', /(^name = "deepseek-herness-linux"\r?\nversion = ")[^"]+/m, `$1${policy.version}`),
  ...['launcher/macos/Info.plist', 'launcher/macos/Info-installed.plist', 'launcher/macos/Info-stop-installed.plist'].map((filename) =>
    stageReplaceMany(filename, [
      [/(<key>CFBundleShortVersionString<\/key>\s*<string>)[^<]+/, `$1${policy.version}`],
      [/(<key>CFBundleVersion<\/key>\s*<string>)[^<]+/, `$1${policy.macBuildVersion}`],
    ])),
])

const written = []
try {
  for (const [target, value] of staged) {
    await writeFile(target, value.next, 'utf8')
    written.push([target, value.original])
  }
} catch (error) {
  for (const [target, original] of written.reverse()) await writeFile(target, original, 'utf8').catch(() => {})
  throw error
}

process.stdout.write(`Set DSH-Portable ${policy.channel} version ${policy.version}.\n`)
