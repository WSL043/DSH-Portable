import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'

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
        appendFileSync(path.join(logDirectory, 'runtime-health.jsonl'), `${JSON.stringify({
          timestamp: new Date().toISOString(), startupId, pid: process.pid,
          component: 'portable-host', observation: 'monitor-failed',
          type: error.name, code: error.code || 'none',
        })}\n`)
      } catch {}
    })
    worker.on('exit', stop)
    const heartbeat = () => {
      const memory = process.memoryUsage()
      worker.postMessage({ phase, heapUsedBytes: memory.heapUsed })
    }
    worker.once('online', heartbeat)
    timer = setInterval(heartbeat, 1000)
    timer.unref()
    worker.unref()
    return nextPhase => { phase = nextPhase; heartbeat() }
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
  let previousCpu = process.cpuUsage()
  let previousSample = performance.now()
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
  })
  setInterval(() => {
    const now = performance.now()
    const age = Math.round(now - heartbeatAt)
    const stalled = age >= 5000
    const cpu = process.cpuUsage()
    const cpuPercent = Math.round((cpu.user - previousCpu.user + cpu.system - previousCpu.system) / ((now - previousSample) * 10))
    previousCpu = cpu
    previousSample = now
    if (!stalled && stalled === wasStalled && now - lastWritten < 30000) return
    try {
      try { if (statSync(filename).size >= 128 * 1024) rotate() } catch {}
      appendFileSync(filename, `${JSON.stringify({
        timestamp: new Date().toISOString(), startupId: workerData.startupId,
        pid: process.pid, component: 'portable-host', phase,
        observation: stalled ? 'main-heartbeat-delayed' : wasStalled ? 'main-heartbeat-recovered' : 'sample',
        mainHeartbeatAgeMs: age, cpuPercent, rssBytes: process.memoryUsage.rss(),
        lastMainHeapUsedBytes: heapUsedBytes,
      })}\n`)
    } catch {}
    wasStalled = stalled
    lastWritten = now
  }, 2000)
}
