$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Payload.psm1') -Force
$source = Get-Content (Join-Path $PSScriptRoot 'candidate.json') -Raw
$count = 0
function Reject($Mutate) {
    $candidate = $source | ConvertFrom-Json
    & $Mutate $candidate
    $rejected = $false
    try { Assert-Candidate $candidate } catch { $rejected = $true }
    if (-not $rejected) { throw 'Unsafe candidate accepted' }
    $script:count++
}
Reject { param($c) $c.url='http://download.deepseek.com/dsh-desk/bin/win-x64/a.exe' }
Reject { param($c) $c.url='https://download.deepseek.com.evil.example/dsh-desk/bin/win-x64/a.exe' }
Reject { param($c) $c.url='https://name@download.deepseek.com/dsh-desk/bin/win-x64/a.exe' }
Reject { param($c) $c.version='../outside' }
Reject { param($c) $c.publisher='Different signer' }
Reject { param($c) $c.size=2147483649 }
Reject { param($c) $c.sha512='invalid' }
Assert-Candidate ($source | ConvertFrom-Json)
Write-Output "$count unsafe candidates rejected; reviewed candidate accepted"
