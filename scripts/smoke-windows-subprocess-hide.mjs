import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const root = path.resolve(process.argv[2] || '')
const childMode = process.argv.includes('--child')
if (process.platform !== 'win32' || !process.argv[2]) {
  throw new Error('usage: node smoke-windows-subprocess-hide.mjs <DSH-Portable root> (Windows only)')
}

const appRoot = path.join(root, 'app')
const portableNode = path.join(root, 'runtime', 'node', 'node.exe')
const trackedHosts = ['OpenConsole.exe', 'WindowsTerminal.exe', 'conhost.exe']
const probeArg = process.argv.indexOf('--probe')
const consoleProbeExe = probeArg >= 0 ? path.resolve(process.argv[probeArg + 1] || '') : ''

async function processCounts() {
  const { stdout } = await execFileAsync('tasklist.exe', ['/FO', 'CSV', '/NH'], {
    encoding: 'utf8', timeout: 5000, windowsHide: true, maxBuffer: 4 * 1024 * 1024,
  })
  const counts = Object.fromEntries(trackedHosts.map(name => [name, 0]))
  for (const line of stdout.split(/\r?\n/)) {
    const name = line.match(/^"([^"]+)"/)?.[1]
    const key = trackedHosts.find(candidate => candidate.toLowerCase() === name?.toLowerCase())
    if (key) counts[key] += 1
  }
  return counts
}

async function runChild() {
  assert.ok(consoleProbeExe && existsSync(consoleProbeExe), 'console visibility probe was not provided')
  const invokeProbe = `& '${consoleProbeExe.replaceAll("'", "''")}'`
  const subprocessFile = path.join(appRoot, 'node_modules', '@deepseek-ai', 'dsh-subprocess-local', 'lib', 'index.js')
  const { default: LocalSubprocessRuntime } = await import(pathToFileURL(subprocessFile).href)
  const runtime = new LocalSubprocessRuntime({ reflect: { provide: () => {} }, effect: () => () => {} })

  const ordinary = runtime.spawn({
    argv: ['powershell.exe', '-NoProfile', '-Command', invokeProbe],
    cwd: root,
    stdio: { stdin: 'ignore', stdout: { maxBytes: 65536 }, stderr: { maxBytes: 65536 } },
    graceMs: 4000,
  })
  const ordinaryOutcome = await ordinary.done
  assert.equal(ordinaryOutcome.exitCode, 0)
  assert.match(ordinary.collected.stdout.finalize().text, /visible=False/i)

  const sleeper = runtime.spawn({
    argv: ['powershell.exe', '-NoProfile', '-Command', 'Start-Sleep -Seconds 30'],
    cwd: root,
    stdio: { stdin: 'ignore', stdout: { maxBytes: 1024 }, stderr: { maxBytes: 1024 } },
    graceMs: 2000,
  })
  await new Promise(resolve => setTimeout(resolve, 500))
  sleeper.terminate()
  await sleeper.done

  const aclPackage = path.join(appRoot, 'node_modules', '@deepseek-ai', 'dsh-sandbox-windows-acl')
  const aclRunner = path.join(aclPackage, 'lib', 'runner.js')
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'dsh-portable-hide-'))
  try {
    const result = await execFileAsync(portableNode, [
      aclRunner, '--workspace', workspace, '--temp', os.tmpdir(), '--mode', 'read-only', '--',
      'powershell.exe', '-NoProfile', '-Command', invokeProbe,
    ], { encoding: 'utf8', timeout: 30000, windowsHide: true, maxBuffer: 1024 * 1024 })
    assert.match(result.stdout, /visible=False/i)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
  process.stdout.write('subprocess-and-acl-ok\n')
}

async function runParent() {
  const subprocessSource = await readFile(path.join(appRoot, 'node_modules', '@deepseek-ai', 'dsh-subprocess-local', 'lib', 'index.js'), 'utf8')
  const aclLib = path.join(appRoot, 'node_modules', '@deepseek-ai', 'dsh-sandbox-windows-acl', 'lib')
  assert.match(subprocessSource, /dsh-portable-windows-subprocess-hide-v1/)
  const { readdir } = await import('node:fs/promises')
  const aclFile = (await readdir(aclLib)).find(name => /^types-[A-Za-z0-9_-]+\.js$/.test(name))
  assert.ok(aclFile, 'compiled Windows ACL module was not found')
  const aclSource = await readFile(path.join(aclLib, aclFile), 'utf8')
  assert.match(aclSource, /dsh-portable-windows-acl-hide-v1/)
  assert.equal(aclSource.match(/dwFlags: 257/g)?.length, 2)
  assert.equal(aclSource.match(/wShowWindow: 0/g)?.length, 2)

  const probeRoot = await mkdtemp(path.join(os.tmpdir(), 'dsh-console-probe-'))
  try {
  const probeSource = path.join(probeRoot, 'probe.cs')
  const probeExe = path.join(probeRoot, 'probe.exe')
  await writeFile(probeSource, `using System;\nusing System.Runtime.InteropServices;\nusing System.Threading;\nclass Probe {\n  [DllImport("kernel32.dll")] static extern IntPtr GetConsoleWindow();\n  [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] static extern bool IsWindowVisible(IntPtr window);\n  static void Main() { Thread.Sleep(900); Console.WriteLine("visible=" + IsWindowVisible(GetConsoleWindow())); }\n}\n`)
  const frameworkRoots = [
    path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
    path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'),
  ]
  const csc = frameworkRoots.find(existsSync)
  assert.ok(csc, 'the Windows C# compiler required by the visibility smoke was not found')
  await execFileAsync(csc, ['/nologo', '/target:exe', `/out:${probeExe}`, probeSource], {
    encoding: 'utf8', timeout: 30000, windowsHide: true,
  })

  const baseline = await processCounts()
  const maximum = { ...baseline }
  const child = spawn(portableNode, [process.argv[1], root, '--child', '--probe', probeExe], {
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', chunk => { stdout += chunk })
  child.stderr.on('data', chunk => { stderr += chunk })
  let closed = false
  const exit = new Promise(resolve => child.on('close', (code, signal) => {
    closed = true
    resolve({ code, signal })
  }))
  while (!closed) {
    const current = await processCounts()
    for (const name of trackedHosts) maximum[name] = Math.max(maximum[name], current[name])
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  const outcome = await exit
  assert.equal(outcome.code, 0, `hidden child failed (${outcome.signal || outcome.code}): ${stderr.slice(0, 1000)}`)
  assert.match(stdout, /subprocess-and-acl-ok/)
  for (const name of ['OpenConsole.exe', 'WindowsTerminal.exe']) {
    assert.equal(maximum[name], baseline[name], `${name} increased during the hidden subprocess smoke`)
  }
  let after = await processCounts()
  const cleanupDeadline = Date.now() + 5000
  while (after['conhost.exe'] > baseline['conhost.exe'] && Date.now() < cleanupDeadline) {
    await new Promise(resolve => setTimeout(resolve, 100))
    after = await processCounts()
  }
  assert.equal(after['OpenConsole.exe'], baseline['OpenConsole.exe'], 'OpenConsole remained after the smoke')
  assert.equal(after['WindowsTerminal.exe'], baseline['WindowsTerminal.exe'], 'Windows Terminal remained after the smoke')
  assert.ok(after['conhost.exe'] <= baseline['conhost.exe'], 'hidden console hosts remained after the smoke')
  process.stdout.write(`${JSON.stringify({ status: 'passed', baseline, maximum, after })}\n`)
  } finally {
    await rm(probeRoot, { recursive: true, force: true })
  }
}

if (childMode) await runChild()
else await runParent()
