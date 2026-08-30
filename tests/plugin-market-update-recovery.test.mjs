import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { mountMarketRoutes } from '../app/vendor/dsh-portable-plugin-market/src/routes.ts'

const ok = (stdout = '') => ({
  exitCode: 0,
  timedOut: false,
  cancelled: false,
  stdout,
  stderr: '',
})

async function writeInstalledPlugin(profile, version) {
  const plugin = path.join(profile, 'node_modules', 'fixture-plugin')
  await mkdir(path.join(plugin, 'lib'), { recursive: true })
  await writeFile(path.join(plugin, 'package.json'), JSON.stringify({
    name: 'fixture-plugin',
    version,
    main: 'lib/index.js',
    dsh: {},
  }))
  await writeFile(path.join(plugin, 'lib', 'index.js'), `export const version = '${version}'\n`)
}

async function updateTestbed(t, { spec = '^1.0.0', lockfile = '', onAdd }) {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'dsh-portable-update-recovery-'))
  t.after(() => rm(profile, { recursive: true, force: true }))
  const manifestFile = path.join(profile, 'package.json')
  await writeFile(manifestFile, JSON.stringify({
    name: 'portable-profile',
    dependencies: { 'fixture-plugin': spec },
    dsh: { profile: { bundles: ['fixture-plugin'] } },
  }, null, 2))
  if (lockfile !== '') await writeFile(path.join(profile, 'pnpm-lock.yaml'), lockfile)
  await writeInstalledPlugin(profile, '1.0.0')

  const calls = []
  const commandRuntime = {
    async runPlugin(_profile, args) {
      calls.push(args)
      if (args[0] === 'store' && args[1] === 'path') return ok(profile)
      if (args[0] === 'add') return await onAdd({ args, target: args.at(-1), manifestFile, profile })
      throw new Error(`unexpected plugin command: ${args.join(' ')}`)
    },
    probePnpm: async () => true,
    provisionPnpm: async () => ({ ok: true }),
    cancelActive: () => false,
  }

  const routes = new Map()
  const host = {
    webServer: {
      register(route) {
        routes.set(route.path, route.handler)
        return () => routes.delete(route.path)
      },
    },
    loader: { entries: () => [] },
    plugin: () => ({ await: async () => undefined, dispose: async () => undefined }),
    on: () => () => undefined,
    logger: { warn: () => undefined },
  }
  const dispose = mountMarketRoutes(host, {
    profile: 'web',
    profileDirectory: profile,
    allowRestart: false,
  }, commandRuntime, () => ({ list: () => [] }))
  t.after(dispose)

  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/fixture-plugin/latest')) {
      return new Response(JSON.stringify({ version: '1.2.0' }), { status: 200 })
    }
    throw new Error(`unexpected fetch: ${String(url)}`)
  }
  t.after(() => { globalThis.fetch = originalFetch })

  const server = createServer((request, response) => {
    const handler = routes.get(new URL(request.url, 'http://127.0.0.1').pathname)
    if (handler === undefined) {
      response.writeHead(404).end()
      return
    }
    void handler(request, response)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => {
    server.close()
    await once(server, 'close')
  })
  const origin = `http://127.0.0.1:${server.address().port}`

  return {
    calls,
    manifestFile,
    profile,
    async update() {
      const response = await originalFetch(`${origin}/dsh-market/update`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin },
        body: JSON.stringify({ name: 'fixture-plugin' }),
      })
      return { response, body: await response.json() }
    },
  }
}

test('a hard-failed npm update restores and verifies the previous package bytes', async (t) => {
  const bed = await updateTestbed(t, {
    async onAdd({ target, manifestFile, profile }) {
      const manifest = JSON.parse(await readFile(manifestFile, 'utf8'))
      if (target === 'fixture-plugin@latest') {
        manifest.dependencies['fixture-plugin'] = '^1.2.0'
        await writeFile(manifestFile, JSON.stringify(manifest, null, 2))
        await writeInstalledPlugin(profile, '1.2.0')
        return { ...ok(), exitCode: 1, stderr: 'ELIFECYCLE: update failed after replacing package files' }
      }
      assert.equal(target, 'fixture-plugin@1.0.0')
      manifest.dependencies['fixture-plugin'] = '1.0.0'
      await writeFile(manifestFile, JSON.stringify(manifest, null, 2))
      await writeInstalledPlugin(profile, '1.0.0')
      return ok()
    },
  })
  const { response, body } = await bed.update()

  assert.equal(response.status, 502)
  assert.equal(body.ok, false)
  assert.equal(JSON.parse(await readFile(bed.manifestFile, 'utf8')).dependencies['fixture-plugin'], '^1.0.0')
  assert.equal(JSON.parse(await readFile(path.join(bed.profile, 'node_modules', 'fixture-plugin', 'package.json'), 'utf8')).version, '1.0.0')
  assert.ok(bed.calls.some(args => args.at(-1) === 'fixture-plugin@1.0.0'))
})

test('a failed npm recovery preserves the original dependency spelling and reports uncertainty', async (t) => {
  const bed = await updateTestbed(t, {
    spec: '~1.0.0',
    async onAdd({ target, manifestFile, profile }) {
      const manifest = JSON.parse(await readFile(manifestFile, 'utf8'))
      manifest.dependencies['fixture-plugin'] = target === 'fixture-plugin@latest' ? '^1.2.0' : '1.0.0'
      await writeFile(manifestFile, JSON.stringify(manifest, null, 2))
      await writeInstalledPlugin(profile, target === 'fixture-plugin@latest' ? '1.2.0' : '1.0.0')
      return {
        ...ok(),
        exitCode: 1,
        stderr: target === 'fixture-plugin@latest' ? 'update failed after write' : 'rollback failed after write',
      }
    },
  })
  const { response, body } = await bed.update()

  assert.equal(response.status, 502)
  assert.match(String(body.error), /未能验证|could not be verified/)
  assert.equal(JSON.parse(await readFile(bed.manifestFile, 'utf8')).dependencies['fixture-plugin'], '~1.0.0')
})

test('a hard-failed GitHub update restores the captured commit and floating source spelling', async (t) => {
  const oldCommit = 'a'.repeat(40)
  const newCommit = 'b'.repeat(40)
  const lockfile = commit => `lockfileVersion: 9\n  resolution: {tarball: https://codeload.github.com/owner/fixture-plugin/tar.gz/${commit}}\n`
  const bed = await updateTestbed(t, {
    spec: 'github:owner/fixture-plugin',
    lockfile: lockfile(oldCommit),
    async onAdd({ target, manifestFile, profile }) {
      const manifest = JSON.parse(await readFile(manifestFile, 'utf8'))
      if (target === 'github:owner/fixture-plugin') {
        await writeInstalledPlugin(profile, '2.0.0')
        await writeFile(path.join(profile, 'pnpm-lock.yaml'), lockfile(newCommit))
        return { ...ok(), exitCode: 1, stderr: 'git update failed after replacing package files' }
      }
      assert.equal(target, `github:owner/fixture-plugin#${oldCommit}`)
      manifest.dependencies['fixture-plugin'] = target
      await writeFile(manifestFile, JSON.stringify(manifest, null, 2))
      await writeInstalledPlugin(profile, '1.0.0')
      await writeFile(path.join(profile, 'pnpm-lock.yaml'), lockfile(oldCommit))
      return ok()
    },
  })
  const { response } = await bed.update()

  assert.equal(response.status, 502)
  assert.equal(JSON.parse(await readFile(bed.manifestFile, 'utf8')).dependencies['fixture-plugin'], 'github:owner/fixture-plugin')
  assert.equal(JSON.parse(await readFile(path.join(bed.profile, 'node_modules', 'fixture-plugin', 'package.json'), 'utf8')).version, '1.0.0')
  assert.match(await readFile(path.join(bed.profile, 'pnpm-lock.yaml'), 'utf8'), new RegExp(oldCommit))
})

test('a failed GitHub recovery keeps the floating source and reports an unverified rollback', async (t) => {
  const oldCommit = 'a'.repeat(40)
  const newCommit = 'b'.repeat(40)
  const lockfile = commit => `lockfileVersion: 9\n  resolution: {tarball: https://codeload.github.com/owner/fixture-plugin/tar.gz/${commit}}\n`
  const bed = await updateTestbed(t, {
    spec: 'github:owner/fixture-plugin',
    lockfile: lockfile(oldCommit),
    async onAdd({ target, manifestFile, profile }) {
      const manifest = JSON.parse(await readFile(manifestFile, 'utf8'))
      if (target === 'github:owner/fixture-plugin') {
        await writeInstalledPlugin(profile, '2.0.0')
        await writeFile(path.join(profile, 'pnpm-lock.yaml'), lockfile(newCommit))
        return { ...ok(), exitCode: 1, stderr: 'git update failed after write' }
      }
      manifest.dependencies['fixture-plugin'] = target
      await writeFile(manifestFile, JSON.stringify(manifest, null, 2))
      return { ...ok(), exitCode: 1, stderr: 'git rollback failed after writing its pinned target' }
    },
  })
  const { response, body } = await bed.update()

  assert.equal(response.status, 502)
  assert.match(String(body.error), /未能验证|could not be verified/)
  assert.equal(JSON.parse(await readFile(bed.manifestFile, 'utf8')).dependencies['fixture-plugin'], 'github:owner/fixture-plugin')
})
