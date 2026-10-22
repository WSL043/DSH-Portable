// Disposable Native-format fixtures and real official Desktop UI acceptance.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { constants, zstdCompressSync } from 'node:zlib';
import { createDataArchive, inspectDataArchive } from '../../../launcher/data-transfer.mjs';
import { layoutForRoot, projectKey } from '../../../launcher/portable-core.mjs';

const identity = () => ({ platform: process.platform, hostname: os.hostname(), username: os.userInfo().username, home: os.homedir() });
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
async function fileSha256(filename) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(filename)) hash.update(bytes);
  return hash.digest('hex');
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const readJson = async filename => JSON.parse((await readFile(filename, 'utf8')).replace(/^\uFEFF/, ''));
async function absent(filename) {
  try { await lstat(filename); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw new Error(`Acceptance requires a fresh path: ${filename}`);
}

async function exportFixture(source, output) {
  source = path.resolve(source); output = path.resolve(output);
  await absent(source); await absent(path.join(output, 'legacy.dshdata')); await absent(path.join(output, 'origin.json'));
  const layout = layoutForRoot(source), fixtureId = randomUUID();
  const id = `session-${fixtureId}`, time = Date.parse('2026-09-04T00:00:00.000Z');
  const title = `Native transfer 中文 ${fixtureId.slice(0, 8)}`;
  const userMessage = `native-transfer-user-${fixtureId}`, assistantMessage = `native-transfer-answer-${fixtureId}`;
  const workspaceTitle = `Native workspace ${fixtureId.slice(0, 8)}`, workspaceFile = '迁移验收.txt';
  const workspaceText = `native-transfer-workspace-${fixtureId}`, settingsMarker = `native-transfer-${fixtureId}`;
  const log = path.join(layout.dshHome, 'sessions', projectKey(layout.workspace), id, 'session.jsonl.zstd');
  for (const directory of [path.dirname(log), layout.workspace, path.join(layout.dshHome, 'storages'),
    path.join(layout.dshHome, 'profiles', 'web', 'node_modules', 'old-plugin'), path.join(layout.dataDir, 'browser'), output]) {
    await mkdir(directory, { recursive: true });
  }
  const header = { type: 'session', version: 0, id, createdAt: time, cwd: layout.workspace, delegationDepth: 0, agentPreset: 'standard' };
  const events = [
    { type: 'turn/start', data: { turn: 1 } },
    { type: 'step/start', data: { turn: 1, step: 1 } },
    { type: 'user/message', surfaceOp: 'append', data: { id: 'migration-user-message', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: userMessage }] } },
    { type: 'session/title', data: { title, messageSeqs: [2], source: { kind: 'fallback' } } },
    { type: 'assistant/message', surfaceOp: 'append', data: { turn: 1, step: 1, message: { id: 'migration-assistant-message', role: 'assistant', source: { kind: 'model', provider: 'smoke', model: 'smoke' }, content: [{ type: 'text', text: assistantMessage }] } } },
    { type: 'step/end', data: { turn: 1, step: 1 } },
    { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ].map((event, seq) => ({ ...event, seq, time: time + seq + 1 }));
  const zstd = bytes => zstdCompressSync(bytes, { params: { [constants.ZSTD_c_checksumFlag]: 1 } });
  await writeFile(log, Buffer.concat([zstd(Buffer.from(JSON.stringify(header) + '\n')), zstd(Buffer.from(events.map(event => JSON.stringify(event)).join('\n') + '\n'))]));
  await writeFile(path.join(layout.workspace, workspaceFile), workspaceText + '\n');
  await writeFile(path.join(layout.dshHome, 'settings.yaml'), `ui-settings-general:\n  welcomeNoticeVersion: ${settingsMarker}\n`);
  await writeFile(path.join(layout.dshHome, 'storages', 'workspace.json'), JSON.stringify({
    unit: { name: 'workspace', version: 2 },
    global: { initialized: true, workspaceIds: ['migration-workspace'], archivedSessionIds: [] },
    tables: { workspaces: { 'migration-workspace': { path: layout.workspace, title: workspaceTitle, sessionIds: [id],
      createdAt: new Date(time).toISOString(), updatedAt: new Date(time).toISOString() } } },
  }));
  // Only synthetic exclusion markers; no account, API key or model call is used.
  const excludedMarker = `EXCLUDED_NATIVE_FIXTURE_${fixtureId}`;
  await writeFile(path.join(layout.dshHome, '.credentials.yaml'), `version: 1\nrefs:\n  env:OLD_NATIVE_TEST: ${excludedMarker}\n`);
  await writeFile(path.join(layout.dshHome, 'profiles', 'web', 'node_modules', 'old-plugin', 'package.json'), JSON.stringify({ name: 'old-plugin', version: '0.0.0' }));
  await writeFile(path.join(layout.dataDir, 'browser', 'Cookies'), excludedMarker);
  await writeFile(path.join(layout.dataDir, 'launcher-settings.json'), JSON.stringify({ fixture: excludedMarker }));
  const archive = path.join(output, 'legacy.dshdata');
  const exported = await createDataArchive(layout, archive, { categories: ['settings', 'sessions', 'workspace'] });
  const inspected = await inspectDataArchive(archive);
  assert.ok(!inspected.files.some(file => /\.credentials|\/profiles\/|\/browser\//.test(file)), 'Private/runtime files escaped export scope');
  const origin = { schemaVersion: 1, kind: 'native-data-acceptance-origin', createdAt: new Date().toISOString(),
    identity: identity(), fixtureId, sessionId: id, sessionVersion: 0, compression: 'checksummed-zstd-frames',
    source, workspace: layout.workspace, title, workspaceTitle, workspaceFile, workspaceText,
    userMessage, assistantMessage, settingsMarker, excludedMarker, archiveSha256: sha256(await readFile(archive)), exported };
  await writeFile(path.join(output, 'origin.json'), JSON.stringify(origin, null, 2) + '\n', { flag: 'wx' });
  return origin;
}

async function until(action, label, timeout = 90000) {
  const deadline = Date.now() + timeout; let last;
  while (Date.now() < deadline) { try { const value = await action(); if (value) return value; } catch (error) { last = error; } await delay(300); }
  throw new Error(`${label}: ${last?.message ?? 'condition not reached'}`);
}
async function connect(url) {
  assert.equal(new URL(url).hostname, '127.0.0.1');
  const socket = new WebSocket(url), pending = new Map(); let sequence = 0;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CDP open timed out')), 5000);
    socket.onopen = () => { clearTimeout(timer); resolve(); }; socket.onerror = () => { clearTimeout(timer); reject(new Error('CDP open failed')); };
  });
  socket.onmessage = ({ data }) => {
    const response = JSON.parse(data), request = pending.get(response.id); if (!request) return;
    pending.delete(response.id); clearTimeout(request.timer);
    if (response.error || response.result?.exceptionDetails) request.reject(new Error(JSON.stringify(response.error ?? response.result.exceptionDetails)));
    else request.resolve(response.result);
  };
  socket.onclose = () => { for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('CDP target closed')); } pending.clear(); };
  const send = (method, params = {}, timeoutMs = 8000) => new Promise((resolve, reject) => {
    const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, timeoutMs);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
  return { send, close: () => socket.close(), evaluate: async expression => (await send('Runtime.evaluate', { expression, returnByValue: true })).result.value };
}
async function click(client, labels, optional = false) {
  const point = () => client.evaluate(`(() => {
    const labels = ${JSON.stringify(labels.map(label => label.toLowerCase()))};
    const found = [...document.querySelectorAll('*')].filter(element => {
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && !element.disabled && [element.innerText, element.getAttribute('aria-label')].some(value => labels.includes((value ?? '').replace(/\\s+/g, ' ').trim().toLowerCase()));
    }).sort((a,b) => a.getBoundingClientRect().width*a.getBoundingClientRect().height-b.getBoundingClientRect().width*b.getBoundingClientRect().height);
    for (const element of found) { element.scrollIntoView({block:'center'}); const box=element.getBoundingClientRect(),x=box.x+box.width/2,y=box.y+box.height/2;
      if(x>0&&y>0&&x<innerWidth&&y<innerHeight&&element.contains(document.elementFromPoint(x,y)))return{x,y}; }
    return null;
  })()`);
  const position = optional ? await point() : await until(point, `Visible control ${labels}`);
  if (!position) return false;
  for (const type of ['mousePressed', 'mouseReleased']) await client.send('Input.dispatchMouseEvent', { type, ...position, button: 'left', clickCount: 1 });
  return true;
}

async function verifyDesktop(root, originPath, port, output) {
  root = path.resolve(root); port = Number(port);
  assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535, 'Invalid CDP port');
  const origin = await readJson(originPath);
  assert.equal(origin.kind, 'native-data-acceptance-origin'); assert.equal(origin.schemaVersion, 1);
  output = path.resolve(output ?? path.join(path.dirname(originPath), 'evidence')); await mkdir(output, { recursive: true });
  const prefix = path.join(output, `native-data-${Date.now()}`), receiver = identity();
  const evidence = { passed: false, inspectedAt: new Date().toISOString(), origin, receiver,
    differentHost: origin.identity.hostname !== receiver.hostname, differentHome: origin.identity.home !== receiver.home,
    credentialsProvided: false, realModelCallsRequested: false, steps: [] };
  let client;
  try {
    const current = await readJson(path.join(root, 'app', 'current.json'));
    assert.match(current.version, /^\d+\.\d+\.\d+(?:-[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*)?$/);
    evidence.product = { githubSha: process.env.GITHUB_SHA ?? null, officialVersion: current.version,
      launcherSha256: await fileSha256(path.join(root, 'DeepSeek Harness Portable.exe')),
      appAsarSha256: await fileSha256(path.join(root, 'app', current.version, 'resources', 'app.asar')),
      verificationScriptSha256: await fileSha256(import.meta.filename),
      importScriptSha256: await fileSha256(path.resolve(import.meta.dirname, '../import-native-data.mjs')) };
    if (process.env.GITHUB_ACTIONS === 'true') assert.ok(evidence.differentHost && evidence.differentHome, 'Cross-machine CI must consume a different runner/home fixture');
    const receipt = await readJson(path.join(root, 'data', 'launcher', 'native-import.json'));
    assert.equal(receipt.archiveSha256, origin.archiveSha256, 'Imported archive identity differs from the producer');
    const targets = async () => (await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(3000) })).json()).filter(target => target.type === 'page');
    let page = await until(async () => (await targets()).find(target => target.url.endsWith('/renderer/welcome.html') || target.url === 'dsh-app://app/'), 'Actual Desktop page');
    client = await connect(page.webSocketDebuggerUrl);
    if (page.url.endsWith('/renderer/welcome.html')) {
      await click(client, ['添加 API Key', 'Add API Key']); await click(client, ['稍后配置', 'Set up later', 'Skip for now']);
      client.close(); client = null;
      page = await until(async () => (await targets()).find(target => target.url === 'dsh-app://app/'), 'Actual workspace after welcome');
      client = await connect(page.webSocketDebuggerUrl); evidence.steps.push('welcome skipped through visible controls without credentials');
    }
    const body = () => client.evaluate('document.body.innerText');
    await until(async () => (await body()).includes(origin.workspaceTitle), 'Imported workspace shown in official UI');
    if (!(await body()).includes(origin.assistantMessage)) await click(client, [origin.title, '未命名', 'Untitled']);
    await until(async () => { const text = await body(); return [origin.title, origin.userMessage, origin.assistantMessage].every(value => text.includes(value)); }, 'Official V0 reader restores title and both messages');
    evidence.steps.push('actual official session reader displayed V0 history, title and both messages');
    const workspace = path.join(root, 'data', 'workspace');
    if (!(await body()).includes(origin.workspaceText)) {
      await click(client, ['打开右侧边栏', 'Open right sidebar'], true);
      await click(client, ['工作区文件', 'Workspace files'], true);
      await until(async () => (await body()).includes(origin.workspaceFile), 'Actual workspace file tree');
      await click(client, [origin.workspaceFile]);
    }
    await until(async () => { const text = await body(); return text.includes(path.join(workspace, origin.workspaceFile)) && text.includes(origin.workspaceText); }, 'Actual workspace path and rendered file contents');
    evidence.steps.push('actual file browser opened the relocated workspace and rendered its file');
    evidence.page = { title: await client.evaluate('document.title'), url: page.url, text: (await body()).slice(0, 14000) };
    evidence.workspace = workspace;
    const home = path.join(root, 'data', 'dsh-home');
    assert.ok((await readFile(path.join(home, 'settings.yaml.imported'), 'utf8')).includes(origin.settingsMarker));
    assert.ok((await readFile(path.join(home, 'profiles', 'desktop', 'cordis.patch.yml'), 'utf8')).includes(origin.settingsMarker), 'Legacy settings did not reach the official desktop profile');
    await absent(path.join(home, 'profiles', 'web')); await absent(path.join(root, 'data', 'browser')); await absent(path.join(root, 'data', 'launcher-settings.json'));
    const credentials = await readFile(path.join(home, '.credentials.yaml'), 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
    assert.ok(!credentials.includes(origin.excludedMarker), 'Synthetic old Native credential was copied');
    assert.equal((await readFile(path.join(workspace, origin.workspaceFile), 'utf8')).trim(), origin.workspaceText);
    evidence.steps.push('official legacy-settings import applied; old credentials, web profile, browser and Native preferences excluded');
    evidence.screenshot = prefix + '.png';
    // Cold Windows runners can delay composition after all DOM checks finish.
    await client.send('Page.bringToFront');
    await writeFile(evidence.screenshot, Buffer.from((await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true }, 30000)).data, 'base64'));
    evidence.passed = true;
    return evidence;
  } catch (error) { evidence.error = error.message; throw error; }
  finally { client?.close(); await writeFile(prefix + '.json', JSON.stringify(evidence, null, 2) + '\n'); }
}

try {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === 'export' && args.length === 2) console.log(JSON.stringify(await exportFixture(...args), null, 2));
  else if (mode === 'verify' && (args.length === 3 || args.length === 4)) console.log(JSON.stringify(await verifyDesktop(...args), null, 2));
  else throw new Error('usage: native-data.mjs export <fresh-source> <artifact-dir> | verify <desktop-root> <origin.json> <probe-port> [evidence-dir]');
} catch (error) { console.error(error.message); process.exitCode = 1; }
