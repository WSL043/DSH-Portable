import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'

const run = promisify(execFile)

test('the native detached process preserves literal arguments and its executable directory', {
  skip: process.platform !== 'win32', timeout: 45_000,
}, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-native-security-'))
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const directory = path.join(root, 'receiver 中文 & space')
  await mkdir(directory)
  const recorder = path.join(directory, 'recorder.exe')
  const driver = path.join(root, 'driver.exe')
  const report = path.join(root, 'arguments.json')
  const recorderSource = path.join(root, 'Recorder.cs')
  const driverSource = path.join(root, 'Driver.cs')
  await writeFile(recorderSource, `using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Web.Script.Serialization;
internal static class Recorder {
  private static void Main(string[] args) {
    File.WriteAllText(args[0], new JavaScriptSerializer().Serialize(new {
      arguments = args.Skip(1).ToArray(), workingDirectory = Environment.CurrentDirectory
    }), new UTF8Encoding(false));
  }
}\n`)
  await writeFile(driverSource, `using System.Linq;
namespace DshPortable {
  internal static class Driver {
    private static void Main(string[] args) {
      PortableProcessJob.StartDetachedProcess(args[0], args.Skip(1));
    }
  }
}\n`)
  const compiler = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe')
  const flags = ['/nologo', '/target:exe', '/platform:x64', '/optimize+', '/reference:System.dll', '/reference:System.Core.dll']
  await run(compiler, [...flags, '/reference:System.Web.Extensions.dll', `/out:${recorder}`, recorderSource], { timeout: 20_000, windowsHide: true })
  await run(compiler, [...flags, `/out:${driver}`, driverSource, path.resolve(import.meta.dirname, '../launcher/windows/PortableProcessJob.cs')], { timeout: 20_000, windowsHide: true })
  const payload = ['', '日本語 中文', 'a&b|c', '%PATH%', '!BANG!', 'quote"here', 'space and trailing\\', 'tab\tvalue']
  await run(driver, [recorder, report, ...payload], { timeout: 10_000, windowsHide: true })
  let result
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    try { result = JSON.parse(await readFile(report, 'utf8')); break } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
    }
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  assert.ok(result, 'the detached native process must produce its own report')
  assert.deepEqual(result.arguments, payload)
  assert.equal((await realpath(result.workingDirectory)).toLowerCase(), (await realpath(directory)).toLowerCase())
})
