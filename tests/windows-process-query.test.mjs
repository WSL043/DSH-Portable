import assert from 'node:assert/strict'
import test from 'node:test'

import { queryWindowsProcess } from '../launcher/portable-core.mjs'

function createAdapter(output, calls = []) {
  return {
    execute: (file, args, options) => {
      calls.push({ file, args, options })
      return output
    },
  }
}

test('queries an existing Windows process with bounded, fail-fast inspection', () => {
  const calls = []
  const result = queryWindowsProcess(1234, createAdapter(JSON.stringify({
    executablePath: 'C:\\Windows\\System32\\node.exe',
    commandLine: 'node.exe launcher\\portable-host.mjs',
  }), calls))

  assert.deepEqual(result, {
    executablePath: 'C:\\Windows\\System32\\node.exe',
    commandLine: 'node.exe launcher\\portable-host.mjs',
  })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].options.timeout, 10000)
  assert.match(calls[0].args.at(-1), /^\$ErrorActionPreference = 'Stop';/)
  assert.match(calls[0].args.at(-1), /Get-CimInstance Win32_Process[\s\S]*-ErrorAction Stop/)
})

test('treats empty Windows process output as confirmed absence', () => {
  const calls = []
  assert.equal(queryWindowsProcess(4321, createAdapter('  \r\n', calls)), null)
  assert.equal(calls.length, 1)
})

test('wraps Windows process query failures and preserves the cause', () => {
  const cause = new Error('query failed')
  const adapter = {
    execute: () => { throw cause },
  }

  assert.throws(
    () => queryWindowsProcess(2468, adapter),
    (error) => {
      assert.equal(error.message, 'Could not inspect process 2468 on Windows.')
      assert.equal(error.cause, cause)
      return true
    },
  )
})

test('wraps malformed or incomplete Windows process output without exposing command lines', () => {
  for (const output of [
    '{bad json',
    JSON.stringify({ executablePath: 'node.exe' }),
    JSON.stringify({ executablePath: 'node.exe', commandLine: '' }),
    JSON.stringify([]),
  ]) {
    assert.throws(
      () => queryWindowsProcess(1357, createAdapter(output)),
      (error) => {
        assert.equal(error.message, 'Could not inspect process 1357 on Windows.')
        assert.ok(error.cause instanceof Error)
        assert.doesNotMatch(error.message, /node\.exe|bad json/)
        return true
      },
    )
  }
})

test('returns null for invalid process IDs without executing PowerShell', () => {
  let executions = 0
  const adapter = { execute: () => { executions += 1 } }

  for (const pid of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 'not-a-pid', Symbol('pid')]) {
    assert.equal(queryWindowsProcess(pid, adapter), null)
  }
  assert.equal(executions, 0)
})
