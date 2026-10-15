import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const script = await readFile(new URL('../experiments/official-payload/apply-update.ps1', import.meta.url), 'utf8')
const helper = /function Invoke-WithNetworkRetry[\s\S]*?\n}\n\n(?=function Write-Atomic)/.exec(script.replace(/\r\n/g, '\n'))?.[0]

function run(body) {
  const code = `
$ErrorActionPreference = 'Stop'
$status = [ordered]@{ status='downloading'; retry=0 }
$statusPath = 'unused'; $CancelFile = $null
$script:writes = New-Object System.Collections.ArrayList
function Write-Atomic($Path, $Value) { [void]$script:writes.Add([int]$Value.retry) }
${helper}
$script:calls = 0
try { ${body}; $outcome = 'ok' } catch { $outcome = 'threw: ' + $_.Exception.Message }
"$outcome calls=$($script:calls) writes=$($script:writes -join ',')"
`
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', code], { encoding: 'utf8', windowsHide: true }).trim()
}

test('a dropped connection is resumed automatically a few times, but integrity and cancel failures never are', { skip: process.platform !== 'win32' }, () => {
  assert.ok(helper, 'the retry helper is present in the update engine')
  assert.match(script, /Invoke-WithNetworkRetry \{ Get-OfficialInstaller \$installer \$candidate /)
  assert.equal(run(`Invoke-WithNetworkRetry { $script:calls++; if ($script:calls -lt 3) { throw 'The operation has timed out' } }`), 'ok calls=3 writes=1,0,2,0')
  assert.match(run(`Invoke-WithNetworkRetry { $script:calls++; throw 'Installer digest mismatch; partial download discarded' }`), /^threw: Installer digest mismatch.* calls=1 writes=$/)
  assert.match(run(`Invoke-WithNetworkRetry { $script:calls++; throw 'Installation cancelled' }`), /^threw: Installation cancelled calls=1/)
  assert.match(run(`Invoke-WithNetworkRetry { $script:calls++; throw 'Unable to read data from the transport connection' } 2`), /^threw: Unable to read data.* calls=2 writes=1,0$/)
})
