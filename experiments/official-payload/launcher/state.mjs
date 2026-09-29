// Pure state transition used to specify the launcher's first-run health gate.
// The shipping supervisor remains C#; its matching predicate is source-locked by tests.
export function assessHealth(state, observation) {
  if (!state || typeof state.version !== 'string' || typeof state.pendingHealth !== 'boolean') {
    throw new Error('Invalid current state');
  }
  if (!state.pendingHealth) return { action: 'supervise', state: { ...state } };
  if (observation?.aliveForMs >= 20_000) {
    return { action: 'healthy', state: { ...state, pendingHealth: false } };
  }
  if (Number.isInteger(observation?.exitCode) && observation.exitCode !== 0 &&
      typeof state.previous === 'string' && state.previous && state.previous !== state.version) {
    return {
      action: 'rollback',
      state: { ...state, version: state.previous, previous: state.version, pendingHealth: false },
    };
  }
  return { action: 'supervise', state: { ...state } };
}

export function parseUpdatedVersion(filename, args) {
  const match = /^deepseek-harness-(\d+\.\d+\.\d+(?:-[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*)?)-win-x64\.exe$/i.exec(filename);
  if (!match || !args.some(arg => arg.toLowerCase() === '--updated')) return null;
  return match[1];
}

export function isValidDshLink(value) {
  return typeof value === 'string' && value.length <= 8192 && /^dsh:\/\//i.test(value) &&
    !/["\x00-\x1f\x7f]/.test(value);
}

