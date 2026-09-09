import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'

const run = promisify(execFile)

test('Windows terminal starts PowerShell with isolated environment and literal working directory', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-terminal & space-'))
  try {
    const probe = path.join(root, 'Probe.cs')
    const executable = path.join(root, 'probe.exe')
    await writeFile(probe, `
using System;
using System.Diagnostics;
using System.Reflection;
class Probe {
  static int Main(string[] args) {
    var method = typeof(DshCommand).GetMethod("TerminalStartInfo", BindingFlags.Static | BindingFlags.NonPublic);
    var originalPath = Environment.GetEnvironmentVariable("PATH");
    var start = (ProcessStartInfo)method.Invoke(null, new object[] { args[0], "test-environment" });
    if (start.UseShellExecute || start.CreateNoWindow || start.WorkingDirectory != args[0]) return 2;
    if (!start.Arguments.Contains("-NoExit") || !start.Arguments.Contains("DSH Terminal")) return 3;
    if (Environment.GetEnvironmentVariable("PATH") != originalPath) return 4;
    start.CreateNoWindow = true;
    start.RedirectStandardOutput = true;
    start.RedirectStandardError = true;
    start.Arguments = "-NoLogo -NoProfile -Command \\\"Write-Output $env:DSH_PORTABLE_TERMINAL; Write-Output $env:DSH_PORTABLE_ENVIRONMENT; Write-Output (Get-Location).Path; Write-Output ($env:PATH.Split(';')[0])\\\"";
    using (var child = Process.Start(start)) {
      var output = child.StandardOutput.ReadToEnd();
      var errors = child.StandardError.ReadToEnd();
      child.WaitForExit();
      Console.Write(output);
      Console.Error.Write(errors);
      return child.ExitCode;
    }
  }
}
`)
    const compiler = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe')
    await run(compiler, ['/nologo', '/target:exe', '/main:Probe', `/out:${executable}`, probe,
      path.resolve(import.meta.dirname, '../launcher/windows/DSH-Command.cs')], { windowsHide: true })
    const origin = '[ZoneTransfer]\r\nZoneId=3\r\n'
    await writeFile(`${executable}:Zone.Identifier`, origin)
    const { stdout, stderr } = await run(executable, [root], { windowsHide: true, timeout: 30_000 })
    assert.equal(stderr, '')
    assert.deepEqual(stdout.trim().split(/\r?\n/), ['1', 'test-environment', root, root])
    assert.equal(await readFile(`${executable}:Zone.Identifier`, 'utf8'), origin)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
