import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Implement only the public updater operations consumed by the official coordinator.
// The official coordinator retains its UI, state machine and task shutdown policy.
export class PortableUpdater extends EventEmitter {
  constructor(root, app, dependencies = {}) {
    super(); this.root = root; this.app = app;
    this.spawn = dependencies.spawn ?? spawn;
    this.readFile = dependencies.readFile ?? readFile;
    this.candidate = undefined;
  }
  async run(operation, version) {
    const statusPath = join(this.root, 'data', 'launcher', 'update-status.json');
    const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(this.root, 'launcher', 'update.ps1'), '-Root', this.root, '-Operation', operation];
    if (version) args.push('-ExpectedVersion', version);
    if (process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_ENVIRONMENT === 'github-hosted' && process.env.DSH_PORTABLE_QUALIFICATION_CANDIDATE) args.push('-QualificationCandidate', process.env.DSH_PORTABLE_QUALIFICATION_CANDIDATE);
    let timer;
    const child = this.spawn(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), args, {windowsHide: true, stdio: 'ignore'});
    if (operation === 'Prepare') timer = setInterval(async () => {
      try {
        const state = JSON.parse((await this.readFile(statusPath, 'utf8')).replace(/^\uFEFF/, ''));
        if (state.version === version && Number.isFinite(state.percent)) this.emit('download-progress', {percent: state.percent});
      } catch { /* Atomic status may not have been written yet. */ }
    }, 500);
    try {
      await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(Error(`Portable ${operation} failed (${code})`))); });
      const result = JSON.parse((await this.readFile(statusPath, 'utf8')).replace(/^\uFEFF/, ''));
      if (result.status === 'failed') throw Error(result.error || 'Portable update failed');
      return result;
    } finally { clearInterval(timer); }
  }
  async checkForUpdates() {
    const result = await this.run('Check');
    if (!['current', 'available', 'ready'].includes(result.status)) throw Error('Unexpected portable check result');
    this.candidate = result.version;
    return {isUpdateAvailable: result.status !== 'current', updateInfo: {version: result.version ?? this.app.getVersion()}};
  }
  async downloadUpdate() {
    if (!this.candidate) throw Error('No checked portable version');
    const result = await this.run('Prepare', this.candidate);
    if (result.status !== 'ready' || result.version !== this.candidate) throw Error('Portable candidate was not prepared');
    this.emit('update-downloaded', {version: this.candidate});
    return [];
  }
  quitAndInstall() {
    const args = [`--restart-after=${process.pid}`];
    const port = this.app.commandLine.getSwitchValue('remote-debugging-port');
    if (port) args.push(`--probe-port=${port}`);
    const child = this.spawn(join(this.root, 'DeepSeek Harness Portable.exe'), args, {windowsHide: true, detached: true, stdio: 'ignore'});
    child.once('error', error => this.emit('error', error));
    child.once('spawn', () => { child.unref(); this.app.quit(); });
  }
}
