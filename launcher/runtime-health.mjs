import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { freemem, totalmem } from 'node:os'

import { appendHistoryLog } from './log-history.mjs'

// Sample only startup, without opening a debug port or recording arguments/source.
// A synchronous stall is sampled by V8, but its summary is flushed on recovery.
export async function startStartupProfile(logDirectory, startupId = '', onProgress = () => {}) {
  let session
  let timer
  let stopped = false
  let hooks
  let moduleCalls = 0
  const moduleTimings = { resolve: { calls: 0, durationMs: 0 }, load: { calls: 0, durationMs: 0 } }
  const slowModules = []
  const safeFile = value => {
    const url = String(value || '').replaceAll('\\', '/').split(/[?#]/)[0]
    const marker = url.lastIndexOf('/node_modules/')
    return String(marker >= 0 ? url.slice(marker + 14) : url.startsWith('node:') ? url : url.split('/').pop()).slice(-180)
  }
  let segmentStarted = performance.now()
  let lastProgressAt = -Infinity
  const progress = (operation, value, state) => {
    const now = performance.now()
    if (now - lastProgressAt < 250) return
    lastProgressAt = now
    // Send bounded checkpoints to the independent health worker. These survive
    // a later blocked/killed main thread even when the final V8 profile cannot.
    try { onProgress({ operation, file: safeFile(value), state,
      elapsedMs: Math.round(now - segmentStarted), moduleCalls,
      resolveCalls: moduleTimings.resolve.calls, loadCalls: moduleTimings.load.calls,
      resolveMs: Math.round(moduleTimings.resolve.durationMs),
      loadMs: Math.round(moduleTimings.load.durationMs) }) } catch {}
  }
  const write = fields => {
    const line = JSON.stringify({ timestamp: new Date().toISOString(), startupId,
      pid: process.pid, component: 'portable-host', ...fields })
    try {
      mkdirSync(logDirectory, { recursive: true })
      appendFileSync(path.join(logDirectory, 'runtime-health.jsonl'), `${line}\n`)
      appendHistoryLog(logDirectory, startupId, 'runtime-health.jsonl', line)
    } catch {}
  }
  try {
    const { Session } = await import('node:inspector/promises')
    session = new Session()
    session.connect()
    await session.post('Profiler.enable')
    await session.post('Profiler.setSamplingInterval', { interval: 10000 })
    await session.post('Profiler.start')
    const { registerHooks } = await import('node:module')
    const measure = (operation, value, context, next) => {
      const begin = performance.now()
      progress(operation, value, 'begin')
      try { return next(value, context) } finally {
        moduleCalls++
        const elapsed = performance.now() - begin
        moduleTimings[operation].calls++
        moduleTimings[operation].durationMs += elapsed
        progress(operation, value, 'complete')
        const durationMs = Math.round(elapsed)
        if (durationMs >= 20) {
          slowModules.push({ operation, file: safeFile(value), durationMs })
          slowModules.sort((a, b) => b.durationMs - a.durationMs)
          slowModules.length = Math.min(8, slowModules.length)
        }
      }
    }
    hooks = registerHooks({
      resolve: (value, context, next) => measure('resolve', value, context, next),
      load: (value, context, next) => measure('load', value, context, next),
    })
    segmentStarted = performance.now()
    write({ observation: 'startup-profiler-started', samplingIntervalUs: 10000 })
  } catch (error) {
    session?.disconnect()
    hooks?.deregister()
    write({ observation: 'startup-profiler-failed', code: error.code || error.name })
    return async () => {}
  }
  const finish = async (reason = 'startup-complete') => {
    if (stopped) return
    stopped = true
    clearTimeout(timer)
    hooks?.deregister()
    try {
      const { profile } = await session.post('Profiler.stop')
      const nodes = new Map(profile.nodes.map(node => [node.id, node]))
      const parents = new Map()
      for (const node of profile.nodes) for (const child of node.children || []) parents.set(child, node.id)
      const weights = new Map()
      for (let i = 0; i < (profile.samples || []).length; i++) {
        const id = profile.samples[i]
        weights.set(id, (weights.get(id) || 0) + (profile.timeDeltas?.[i] || 0))
      }
      const frame = node => {
        const call = node?.callFrame || {}
        // Strip local user directories, URL queries and dynamic script names.
        return { function: String(call.functionName || '(anonymous)').slice(0, 100),
          file: safeFile(call.url), line: (call.lineNumber ?? -1) + 1 }
      }
      const grouped = new Map()
      for (const [id, us] of weights) {
        const stack = []
        for (let cursor = id; cursor && stack.length < 6; cursor = parents.get(cursor)) stack.push(frame(nodes.get(cursor)))
        const key = JSON.stringify(stack)
        const previous = grouped.get(key)
        if (previous) previous.us += us
        else grouped.set(key, { us, stack })
      }
      const hotStacks = [...grouped.values()].sort((a, b) => b.us - a.us).slice(0, 8)
        .map(({ us, stack }) => ({ sampledMs: Math.round(us / 1000), stack }))
      for (const timing of Object.values(moduleTimings)) timing.durationMs = Math.round(timing.durationMs)
      write({ observation: 'startup-profile', reason,
        durationMs: Math.round(performance.now() - segmentStarted),
        sampleCount: profile.samples?.length || 0, hotStacks,
        moduleCalls, moduleTimings, slowModules, slowModuleThresholdMs: 20,
        omittedStacks: Math.max(0, grouped.size - hotStacks.length),
        limitation: 'Statistical JS stacks; native waits and permanent stalls require OS tracing.' })
    } catch (error) {
      write({ observation: 'startup-profiler-failed', code: error.code || error.name })
    } finally { session.disconnect() }
  }
  timer = setTimeout(() => { void finish('startup-time-budget') }, 60000)
  timer.unref()
  return finish
}

// A separate thread can record a missing main-thread heartbeat while DSH is
// synchronously blocked. It does not inspect user messages or process arguments.
export function startRuntimeHealth(logDirectory, startupId = '') {
  if (!isMainThread) return () => {}
  let worker
  let timer
  let phase = 'host-initializing'
  try {
    worker = new Worker(new URL(import.meta.url), { workerData: { logDirectory, startupId } })
    const stop = () => { clearInterval(timer); worker.unref() }
    worker.on('error', error => {
      stop()
      try {
        const line = JSON.stringify({
          timestamp: new Date().toISOString(), startupId, pid: process.pid,
          component: 'portable-host', observation: 'monitor-failed',
          type: error.name, code: error.code || 'none',
        })
        appendFileSync(path.join(logDirectory, 'runtime-health.jsonl'), `${line}\n`)
        appendHistoryLog(logDirectory, startupId, 'runtime-health.jsonl', line)
      } catch {}
    })
    worker.on('exit', stop)
    const heartbeat = startupProgress => {
      const memory = process.memoryUsage()
      worker.postMessage({ phase, heapUsedBytes: memory.heapUsed, startupProgress })
    }
    worker.once('online', heartbeat)
    timer = setInterval(heartbeat, 1000)
    timer.unref()
    worker.unref()
    return (nextPhase, startupProgress) => { if (nextPhase) phase = nextPhase; heartbeat(startupProgress) }
  } catch {
    clearInterval(timer)
    worker?.unref()
    return () => {}
  }
}

if (!isMainThread && workerData?.logDirectory) {
  const filename = path.join(workerData.logDirectory, 'runtime-health.jsonl')
  let heartbeatAt = performance.now()
  let phase = 'awaiting-main-heartbeat'
  let heapUsedBytes = null
  let startupProgress = null
  let previousCpu = process.cpuUsage()
  let previousSample = performance.now()
  const systemTotalMemoryBytes = totalmem()
  let lastWritten = -Infinity
  let wasStalled = false
  const rotate = () => {
    rmSync(`${filename}.previous`, { force: true })
    try { renameSync(filename, `${filename}.previous`) } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  try { mkdirSync(workerData.logDirectory, { recursive: true }); rotate() } catch {}
  parentPort.on('message', heartbeat => {
    heartbeatAt = performance.now()
    phase = heartbeat.phase
    heapUsedBytes = heartbeat.heapUsedBytes
    if (heartbeat.startupProgress) startupProgress = heartbeat.startupProgress
  })
  setInterval(() => {
    const now = performance.now()
    const age = Math.round(now - heartbeatAt)
    const stalled = age >= 5000
    const cpu = process.cpuUsage()
    const sampleIntervalMs = now - previousSample
    const cpuPercent = Math.round((cpu.user - previousCpu.user + cpu.system - previousCpu.system) / (sampleIntervalMs * 10))
    previousCpu = cpu
    previousSample = now
    if (!stalled && phase === 'official-dsh-import-complete' && stalled === wasStalled && now - lastWritten < 30000) return
    try {
      try { if (statSync(filename).size >= 128 * 1024) rotate() } catch {}
      const line = JSON.stringify({
        timestamp: new Date().toISOString(), startupId: workerData.startupId,
        pid: process.pid, component: 'portable-host', phase,
        observation: stalled ? 'main-heartbeat-delayed' : wasStalled ? 'main-heartbeat-recovered' : 'sample',
        mainHeartbeatAgeMs: age, cpuPercent, rssBytes: process.memoryUsage.rss(),
        sampleIntervalMs: Math.round(sampleIntervalMs),
        systemFreeMemoryBytes: freemem(), systemTotalMemoryBytes,
        lastMainHeapUsedBytes: heapUsedBytes,
        ...(startupProgress ? { startupProgress } : {}),
      })
      appendFileSync(filename, `${line}\n`)
      appendHistoryLog(workerData.logDirectory, workerData.startupId, 'runtime-health.jsonl', line)
    } catch {}
    wasStalled = stalled
    lastWritten = now
  }, 2000)
}
