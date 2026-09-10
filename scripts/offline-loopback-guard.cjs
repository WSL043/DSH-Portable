// Acceptance fixture only. This is not an OS sandbox or a product offline mode.
// Run Node with --require <this file>; non-Node subprocesses are not covered.
const net = require('node:net');
const fs = require('node:fs');
const { syncBuiltinESMExports } = require('node:module');
const original = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const host = first && typeof first === 'object' ? first.host : typeof args[1] === 'string' ? args[1] : undefined;
  const pipe = first && typeof first === 'object' ? first.path : typeof first === 'string' && !/^\d+$/.test(first) ? first : undefined;
  if (!pipe && host && !['127.0.0.1', '::1', 'localhost'].includes(host)) {
    if (process.env.DSH_OFFLINE_EVIDENCE) fs.appendFileSync(process.env.DSH_OFFLINE_EVIDENCE, JSON.stringify({time:new Date().toISOString(),pid:process.pid,blockedHost:host})+'\n');
    const error = new Error('Offline acceptance: non-loopback connection denied');
    error.code = 'ENETUNREACH';
    throw error;
  }
  return original.apply(this,args);
};
syncBuiltinESMExports();
