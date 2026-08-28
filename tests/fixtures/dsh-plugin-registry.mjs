import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'

const [v1Archive, v2Archive, channelFile, readyFile, clsxArchive, clsxVersion = '2.1.1', defaultPluginArchive, defaultPluginVersion, imageViewerArchive, imageViewerVersion] = process.argv.slice(2)
if (!v1Archive || !v2Archive || !channelFile || !readyFile || !clsxArchive) {
  throw new Error('usage: dsh-plugin-registry.mjs <v1.tgz> <v2.tgz> <channel> <ready.json> <clsx.tgz> [clsx-version] [default-plugin.tgz] [default-plugin-version] [image-viewer.tgz] [image-viewer-version]')
}

const packageName = 'dsh-portable-smoke-plugin'
const releases = new Map([
  ['1.0.0', archiveRelease('1.0.0', v1Archive)],
  ['1.0.1', archiveRelease('1.0.1', v2Archive)],
])
const clsxRelease = archiveRelease(clsxVersion, clsxArchive)
const defaultReleases = new Map()
if (defaultPluginArchive && defaultPluginVersion) {
  defaultReleases.set('dsh-chat-manager', archiveRelease(defaultPluginVersion, defaultPluginArchive))
}
if (imageViewerArchive && imageViewerVersion) defaultReleases.set('dsh-image-viewer', archiveRelease(imageViewerVersion, imageViewerArchive))

function archiveRelease(version, filename) {
  const body = readFileSync(filename)
  return {
    version,
    filename: path.resolve(filename),
    body,
    shasum: createHash('sha1').update(body).digest('hex'),
    integrity: `sha512-${createHash('sha512').update(body).digest('base64')}`,
  }
}

function currentVersion() {
  const selected = readFileSync(channelFile, 'utf8').trim()
  if (!releases.has(selected)) throw new Error(`unsupported fixture channel: ${selected}`)
  return selected
}

function metadata(origin) {
  const latest = currentVersion()
  return {
    _id: packageName,
    name: packageName,
    'dist-tags': { latest },
    versions: Object.fromEntries([...releases].map(([version, release]) => [version, {
      name: packageName,
      version,
      private: false,
      license: 'MIT',
      dist: {
        tarball: `${origin}/${packageName}/-/${packageName}-${version}.tgz`,
        shasum: release.shasum,
        integrity: release.integrity,
      },
    }])),
  }
}

function clsxMetadata(origin) {
  return {
    _id: 'clsx',
    name: 'clsx',
    'dist-tags': { latest: clsxVersion },
    versions: {
      [clsxVersion]: {
        name: 'clsx',
        version: clsxVersion,
        license: 'MIT',
        dist: {
          tarball: `${origin}/clsx/-/clsx-${clsxVersion}.tgz`,
          shasum: clsxRelease.shasum,
          integrity: clsxRelease.integrity,
        },
      },
    },
  }
}

function defaultPluginMetadata(origin, name, release) {
  return {
    _id: name,
    name,
    'dist-tags': { latest: release.version },
    versions: {
      [release.version]: {
        name,
        version: release.version,
        license: 'MIT',
        dist: {
          tarball: `${origin}/${name}/-/${name}-${release.version}.tgz`,
          shasum: release.shasum,
          integrity: release.integrity,
        },
      },
    },
  }
}

const server = http.createServer((request, response) => {
  const origin = `http://127.0.0.1:${server.address().port}`
  const pathname = new URL(request.url, origin).pathname
  if (request.method === 'GET' && pathname === `/${packageName}`) {
    const body = Buffer.from(JSON.stringify(metadata(origin)), 'utf8')
    response.writeHead(200, {
      'content-type': 'application/json',
      'content-length': body.length,
      'cache-control': 'no-store',
    }).end(body)
    return
  }
  if (request.method === 'GET' && pathname === '/clsx') {
    const body = Buffer.from(JSON.stringify(clsxMetadata(origin)), 'utf8')
    response.writeHead(200, {
      'content-type': 'application/json',
      'content-length': body.length,
      'cache-control': 'no-store',
    }).end(body)
    return
  }
  const defaultMetadataName = pathname.slice(1)
  if (request.method === 'GET' && defaultReleases.has(defaultMetadataName)) {
    const body = Buffer.from(JSON.stringify(defaultPluginMetadata(origin, defaultMetadataName, defaultReleases.get(defaultMetadataName))), 'utf8')
    response.writeHead(200, {
      'content-type': 'application/json',
      'content-length': body.length,
      'cache-control': 'no-store',
    }).end(body)
    return
  }
  const match = pathname.match(new RegExp(`^/${packageName}/-/${packageName}-(1\\.0\\.[01])\\.tgz$`))
  if (request.method === 'GET' && match) {
    const release = releases.get(match[1])
    response.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': release.body.length,
      'cache-control': 'no-store',
    }).end(release.body)
    return
  }
  if (request.method === 'GET' && pathname === `/clsx/-/clsx-${clsxVersion}.tgz`) {
    response.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': clsxRelease.body.length,
      'cache-control': 'no-store',
    }).end(clsxRelease.body)
    return
  }
  const defaultArchiveEntry = [...defaultReleases].find(([name, release]) => (
    pathname === `/${name}/-/${name}-${release.version}.tgz`
  ))
  if (request.method === 'GET' && defaultArchiveEntry) {
    const defaultArchiveRelease = defaultArchiveEntry[1]
    response.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': defaultArchiveRelease.body.length,
      'cache-control': 'no-store',
    }).end(defaultArchiveRelease.body)
    return
  }
  response.writeHead(404, { 'content-type': 'text/plain' }).end('not found')
})

server.listen(0, '127.0.0.1', () => {
  const payload = `${JSON.stringify({ port: server.address().port })}\n`
  writeFileSync(readyFile, payload, 'utf8')
})

function close() {
  server.close(() => process.exit(0))
}
process.on('SIGINT', close)
process.on('SIGTERM', close)
