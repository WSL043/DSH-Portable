// Native CDP acceptance of an unmodified official executable, disposable data only.
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
const [port, output, fixture, mode = 'install'] = process.argv.slice(2);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const evidence = { passed: false, steps: [] };
let client;
async function connect(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl), pending = new Map();
  await new Promise((resolve, reject) => { const timer=setTimeout(()=>reject(new Error('CDP connect timeout')),5000); socket.onopen=()=>{clearTimeout(timer);resolve();};socket.onerror=()=>{clearTimeout(timer);reject(new Error('CDP error'));}; });
  let seq = 0;
  socket.onmessage = ({data}) => {
    const r=JSON.parse(data);
    if(r.method==='Runtime.exceptionThrown'||(r.method==='Runtime.consoleAPICalled'&&r.params?.type==='error')) {
      evidence.rendererErrors ??= [];
      if(evidence.rendererErrors.length<20)evidence.rendererErrors.push(r.params);
    }
    const p=pending.get(r.id); if (!p) return;
    pending.delete(r.id);clearTimeout(p.timer);
    if(r.error||r.result?.exceptionDetails)p.reject(new Error(JSON.stringify(r.error??r.result.exceptionDetails)));else p.resolve(r.result);
  };
  socket.onclose = () => { for (const p of pending.values()) {clearTimeout(p.timer);p.reject(new Error('CDP target closed'));} pending.clear(); };
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(new Error(`${method} timeout`));},8000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
  await send('Runtime.enable');
  return {send, close:()=>socket.close(), evaluate:async expression=>(await send('Runtime.evaluate',{expression,returnByValue:true})).result.value};
}
async function targets() {return await(await fetch(`http://127.0.0.1:${Number(port)}/json/list`,{signal:AbortSignal.timeout(1000)})).json();}
async function until(fn, description, milliseconds=45000) {
  const deadline=Date.now()+milliseconds; let last;
  while(Date.now()<deadline){try{const result=await fn();if(result)return result;}catch(error){last=error;}await delay(400);}
  throw new Error(`${description}: ${last??'condition not reached'}`);
}
async function click(text, selector='button') {
  const expression=`[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.getClientRects().length&&!e.disabled&&${JSON.stringify(text)}.some(t=>e.textContent.trim()===t||e.getAttribute('aria-label')===t))`;
  await until(()=>client.evaluate(`(()=>{const e=${expression};if(!e)return false;e.scrollIntoView({block:'center'});return true;})()`),`Button ${text}`);
  await delay(250);
  const point=await until(()=>client.evaluate(`(()=>{const e=${expression};if(!e)return null;const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(x<0||y<0||x>=innerWidth||y>=innerHeight||!e.contains(document.elementFromPoint(x,y)))return null;return{x,y};})()`),`Unobstructed button ${text}`);
  await client.send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
  for(const type of ['mousePressed','mouseReleased'])await client.send('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount:1});
}
async function snapshot(name) {
  await writeFile(`${output}.${name}.png`,Buffer.from((await client.send('Page.captureScreenshot')).data,'base64'));
  evidence[name]=await client.evaluate(`({text:document.body.innerText.slice(0,5000),buttons:[...document.querySelectorAll('button')].filter(e=>e.getClientRects().length).map(e=>({text:e.textContent.trim(),label:e.getAttribute('aria-label'),checked:e.getAttribute('aria-checked')})),editors:[...document.querySelectorAll('[contenteditable=true],textarea')].filter(e=>e.getClientRects().length).length})`);
}
try {
  const welcome=await until(async()=> (await targets()).find(t=>t.type==='page'&&t.url.endsWith('/renderer/welcome.html')),'Welcome');
  client=await connect(welcome);
  await until(()=>client.evaluate(`typeof window.dshWelcome?.skip==='function'`),'Welcome API');
  await snapshot('welcome');
  await client.evaluate('void window.dshWelcome.skip()');client.close();
  client=await connect(await until(async()=>(await targets()).find(t=>t.type==='page'&&t.url==='dsh-app://app/'),'Workspace'));
  await until(()=>client.evaluate(`!![...document.querySelectorAll('[contenteditable=true],textarea')].find(e=>e.getClientRects().length)`),'Visible editor');
  if(['moved','upgraded'].includes(mode)&&!await client.evaluate(`document.body.innerText.includes('Portable alpha2 input acceptance 123')`))throw new Error('Draft lost after directory relocation or upgrade');
  await client.evaluate(`(()=>{const e=[...document.querySelectorAll('[contenteditable=true],textarea')].find(e=>e.getClientRects().length);e.focus();})()`);
  await client.send('Input.insertText',{text:'Portable alpha2 input acceptance 123'});
  if(!await client.evaluate(`(document.activeElement.textContent||document.activeElement.value).includes('Portable alpha2 input acceptance 123')`))throw new Error('Input not retained');
  evidence.steps.push('actual editor input');await snapshot('workspace');
  await click(['Plugins','插件']);await snapshot('plugins');
  for(const name of ['dsh-chat-manager','@wsl043/dsh-portable-plugin-market']) {
    const expected = name==='dsh-chat-manager' && mode==='moved' ? 'false' : 'true';
    const label=name==='dsh-chat-manager'?'Session Manager':name;
    await until(()=>client.evaluate(`document.querySelector('button[aria-label="Enable ${label}"]')?.getAttribute('aria-checked')==='${expected}'`),`Default ${name} state ${expected} in official UI`);
    if(expected==='false') {
      evidence.steps.push('disabled default remains disabled after restart and relocation');
      await click(['Enable Session Manager','启用会话管理','启用 会话管理']);
    }
  }
  if(await client.evaluate(`document.body.innerText.includes('dsh-image-viewer')`))throw Error('Removed image viewer still bundled by default');
  await click(['Plugin market','插件市场']);
  await until(()=>client.evaluate(`document.querySelectorAll('[data-market-card]').length>0`),'Standalone market catalog renders',90000);
  await snapshot('market');
  await click(['Plugins','插件']);
  await click(['Enable @wsl043/dsh-portable-plugin-market','启用 @wsl043/dsh-portable-plugin-market']);
  await until(()=>client.evaluate(`![...document.querySelectorAll('button')].some(e=>e.getClientRects().length&&['Plugin market','插件市场'].includes(e.textContent.trim()))`),'Disabled market removes sidebar entry');
  await click(['Enable @wsl043/dsh-portable-plugin-market','启用 @wsl043/dsh-portable-plugin-market']);
  await until(()=>client.evaluate(`document.querySelector('button[aria-label="Enable @wsl043/dsh-portable-plugin-market"],button[aria-label="启用 @wsl043/dsh-portable-plugin-market"]')?.getAttribute('aria-checked')==='true'`),'Market reactivation');
  evidence.steps.push('two default plugins enabled; standalone market loads and disables cleanly; image viewer absent');
  if(mode==='install') {
    await click(['Enable Session Manager','启用会话管理','启用 会话管理']);
    await until(()=>client.evaluate(`document.querySelector('button[aria-label="Enable Session Manager"]')?.getAttribute('aria-checked')==='false'`),'Disable default chat manager before restart and relocation');
    evidence.steps.push('default chat manager disabled for restart persistence check');
  }
  if(fixture && mode === 'install'){
    await click(['Add plugin','Add Plugin','添加插件']);
    await until(()=>client.evaluate(`(()=>{const e=document.querySelector('[role=dialog] input[type=text]');if(!e)return false;e.focus();return true;})()`),'Install input');
    await client.send('Input.insertText',{text:fixture});await click(['Install','安装']);
    await click(['Enable now','Enable Now','立即启用']);
    await until(async()=> (await readFile(join(process.env.DSH_HOME,'acceptance-plugin-state.txt'),'utf8'))==='enabled','Actual plugin activation');
    await until(()=>client.evaluate(`document.querySelector('button[aria-label="Enable dsh-portable-acceptance-fixture"],button[aria-label="启用 dsh-portable-acceptance-fixture"]')?.getAttribute('aria-checked')==='true'`),'Enabled state reflected in official UI');
    evidence.steps.push('actual plugin install/enable');await snapshot('installed');
    await click(['Enable dsh-portable-acceptance-fixture','启用 dsh-portable-acceptance-fixture']);
    await until(async()=> (await readFile(join(process.env.DSH_HOME,'acceptance-plugin-state.txt'),'utf8'))==='disabled','Actual plugin deactivation');
    evidence.steps.push('actual plugin disable');
  }
  if(['moved','upgraded'].includes(mode)){
    await until(()=>client.evaluate(`document.querySelector('button[aria-label="Enable dsh-portable-acceptance-fixture"],button[aria-label="启用 dsh-portable-acceptance-fixture"]')?.getAttribute('aria-checked')==='false'`),'Moved disabled state reflected in official UI');
    await click(['Enable dsh-portable-acceptance-fixture','启用 dsh-portable-acceptance-fixture']);
    await until(async()=> (await readFile(join(process.env.DSH_HOME,'acceptance-plugin-state.txt'),'utf8'))==='enabled','Moved plugin activation');
    evidence.steps.push('moved plugin activation');
    await click(['View dsh-portable-acceptance-fixture','查看 dsh-portable-acceptance-fixture']);
    await snapshot('detail');
    await click(['Uninstall dsh-portable-acceptance-fixture','卸载 dsh-portable-acceptance-fixture']);
    await click(['Uninstall','卸载'],'[role=dialog] button');
    await until(()=>client.evaluate(`!document.body.innerText.includes('dsh-portable-acceptance-fixture')`),'Moved plugin uninstall');
    const manifest=JSON.parse(await readFile(join(process.env.DSH_HOME,'profiles','desktop','package.json'),'utf8'));
    if(manifest.dependencies?.['dsh-portable-acceptance-fixture'])throw new Error('Uninstalled plugin remains in profile dependencies');
    evidence.steps.push('moved plugin uninstall');await snapshot('uninstalled');
  }
  // Exercise both the registered wrapper and the previous browser bypass entry.
  const root=process.env.DSH_PORTABLE_DEVELOPMENT_ROOT;
  const selected=JSON.parse((await readFile(join(root,'app','current.json'),'utf8')).replace(/^\uFEFF/,''));
  const official=join(root,'app',selected.version,'DeepSeek Harness.exe');
  const owner=()=>execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command', '(Get-NetTCPConnection -State Listen -LocalPort 19387 -ErrorAction SilentlyContinue).OwningProcess'],{windowsHide:true,encoding:'utf8'}).trim();
  const originalOwner=owner();
  for(const executable of [join(root,'DeepSeek Harness Portable.exe'),official]) {
    const env={...process.env};delete env.DSH_PORTABLE_ROOT;
    execFileSync(executable,['dsh://open/'],{env,windowsHide:true,timeout:20000});
    await delay(1200);
    if(owner()!==originalOwner)throw new Error('Protocol return replaced the active host');
  }
  evidence.steps.push('wrapper and direct EXE protocol return preserve host');
  execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command', "$ErrorActionPreference='Stop'; Start-Process -FilePath 'dsh://open/' -WindowStyle Hidden"],{windowsHide:true,timeout:20000});
  await delay(1200);
  if(owner()!==originalOwner)throw new Error('Windows protocol dispatch replaced the active host');
  evidence.steps.push('Windows ShellExecute protocol return preserves host');
  const registration=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command', '[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); (Get-ItemProperty "Registry::HKEY_CURRENT_USER\\Software\\Classes\\dsh\\shell\\open\\command")."(default)"'],{windowsHide:true,encoding:'utf8'});
  evidence.protocolRegistration=registration;
  if(!registration.includes(join(root,'DeepSeek Harness Portable.exe')))throw new Error('Protocol registry bypasses portable launcher');
  await client.evaluate('void window.dshDesktop.updates.open()');
  await until(async()=>{
    await client.evaluate('void window.dshDesktop.updates.status().then(x=>window.__portableUpdateResult=x)');
    const result=JSON.parse((await readFile(join(root,'data','launcher','update-status.json'),'utf8')).replace(/^\uFEFF/,''));
    return result.status==='current';
  },'Real portable update check');
  await delay(700);
  evidence.updateTargets=(await targets()).map(({type,url})=>({type,url}));
  await client.evaluate('void window.dshDesktop.updates.status().then(x=>window.__portableUpdateResult=x)');
  await delay(500);evidence.updateStatus=await client.evaluate('window.__portableUpdateResult');
  if(evidence.updateStatus?.phase!=='idle')throw new Error('Official update UI did not receive portable current state');
  evidence.steps.push('official update action uses portable check without missing-source error');
  const dialogs=(await targets()).filter(t=>t.type==='page'&&t.url.includes('update-dialog'));
  for(const target of dialogs){const dialog=await connect(target);try{await writeFile(`${output}.update.png`,Buffer.from((await dialog.send('Page.captureScreenshot')).data,'base64'));}finally{dialog.close();}}
  // Corrupt only the disposable runner's catalog, then recover through the same UI.
  const candidateFile=process.env.DSH_PORTABLE_QUALIFICATION_CANDIDATE;
  if(process.env.GITHUB_ACTIONS!=='true'||process.env.RUNNER_ENVIRONMENT!=='github-hosted'||!candidateFile)throw Error('Update failure acceptance requires a disposable candidate');
  const candidateBytes=await readFile(candidateFile);
  const dismiss=async()=>{
    const target=(await targets()).find(t=>t.type==='page'&&t.url.includes('update-dialog'));
    if(!target)return;
    const workspace=client;client=await connect(target);
    try {
      const result=await client.send('Runtime.evaluate',{expression:'window.dshUpdateDialog.status()',awaitPromise:true,returnByValue:true});
      const view=result.result.value;
      if(view)await click([view.buttons[view.cancelId]??view.buttons[0]]);
    } finally {client.close();client=workspace;}
    await delay(400);
  };
  const phase=async()=>(await client.send('Runtime.evaluate',{expression:'window.dshDesktop.updates.status()',awaitPromise:true,returnByValue:true})).result.value.phase;
  try {
    await dismiss();
    await writeFile(candidateFile,'{"schemaVersion":-1}');
    await client.evaluate('void window.dshDesktop.updates.open()');
    await until(async()=>await phase()==='error','Official UI shows failed catalog check');
    evidence.steps.push('actual invalid catalog surfaces check error');
  } finally {await writeFile(candidateFile,candidateBytes);}
  await dismiss();
  await client.evaluate('void window.dshDesktop.updates.open()');
  await until(async()=>await phase()==='idle','Official UI retries after failed check');
  evidence.steps.push('official update retry recovers without restart');
  await dismiss();
  const rootEnv={...process.env,DSH_PORTABLE_ACCEPTANCE_EXE:official};
  const mainPid=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command', `(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $env:DSH_PORTABLE_ACCEPTANCE_EXE -and $_.CommandLine -like '*--user-data-dir=*' -and $_.CommandLine -notlike '*--type=*' }).ProcessId`],{env:rootEnv,windowsHide:true,encoding:'utf8'}).trim();
  if(!/^\d+$/.test(mainPid))throw Error('Cannot identify the unique portable main process');
  const restart=spawn(join(root,'DeepSeek Harness Portable.exe'),[`--restart-after=${mainPid}`,`--probe-port=${port}`],{windowsHide:true,stdio:'ignore'});
  const restarted=new Promise((resolve,reject)=>{restart.once('error',reject);restart.once('exit',code=>code===0?resolve():reject(Error(`Restart helper exit ${code}`)));});
  // Attach rejection immediately while CDP waits for the old window to close.
  restarted.catch(()=>{});
  try{await client.send('Browser.close');}catch(error){if(!String(error).includes('CDP target closed'))throw error;}
  client.close();
  await until(async()=>{const pid=owner();return pid&&pid!==originalOwner;},'Restart replaces the old host',60000);
  const newWelcome=await until(async()=>(await targets()).find(t=>t.type==='page'&&t.url.endsWith('/renderer/welcome.html')),'Restart welcome');
  client=await connect(newWelcome);
  await until(()=>client.evaluate(`typeof window.dshWelcome?.skip==='function'`),'Restart welcome API');
  await client.evaluate('void window.dshWelcome.skip()');client.close();
  client=await connect(await until(async()=>(await targets()).find(t=>t.type==='page'&&t.url==='dsh-app://app/'),'Restart workspace'));
  await until(()=>client.evaluate(`!![...document.querySelectorAll('[contenteditable=true],textarea')].find(e=>e.getClientRects().length)`),'Restart visible editor');
  if(!await client.evaluate(`document.body.innerText.includes('Portable alpha2 input acceptance 123')`))throw Error('Restart lost the portable draft');
  await until(()=>restart.exitCode!==null,'Restart helper exits');await restarted;
  evidence.steps.push('native restart helper waits for old process and preserves draft');
  await snapshot('restarted');
  evidence.passed=true;
  try { await client.send('Browser.close'); } catch(error) { if(!String(error).includes('CDP target closed'))throw error; }
} catch(error){ evidence.error=String(error);process.exitCode=1;try{await snapshot('failure');}catch{} }
finally{
  if(!evidence.passed&&client){try{await client.send('Browser.close');}catch{}}
  client?.close();await writeFile(output,JSON.stringify(evidence,null,2));
}
