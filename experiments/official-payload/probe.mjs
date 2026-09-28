// Native CDP acceptance of an unmodified official executable, disposable data only.
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
const [port, output, fixture, mode = 'install'] = process.argv.slice(2);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const evidence = { passed: false, steps: [] };
let client;
async function connect(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl), pending = new Map();
  await new Promise((resolve, reject) => { const timer=setTimeout(()=>reject(new Error('CDP connect timeout')),5000); socket.onopen=()=>{clearTimeout(timer);resolve();};socket.onerror=()=>{clearTimeout(timer);reject(new Error('CDP error'));}; });
  let seq = 0;
  socket.onmessage = ({data}) => {
    const r=JSON.parse(data), p=pending.get(r.id); if (!p) return;
    pending.delete(r.id);clearTimeout(p.timer);
    if(r.error||r.result?.exceptionDetails)p.reject(new Error(JSON.stringify(r.error??r.result.exceptionDetails)));else p.resolve(r.result);
  };
  socket.onclose = () => { for (const p of pending.values()) {clearTimeout(p.timer);p.reject(new Error('CDP target closed'));} pending.clear(); };
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(new Error(`${method} timeout`));},8000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
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
  await client.evaluate(`(()=>{const e=[...document.querySelectorAll('[contenteditable=true],textarea')].find(e=>e.getClientRects().length);e.focus();})()`);
  await client.send('Input.insertText',{text:'Portable alpha2 input acceptance 123'});
  if(!await client.evaluate(`(document.activeElement.textContent||document.activeElement.value).includes('Portable alpha2 input acceptance 123')`))throw new Error('Input not retained');
  evidence.steps.push('actual editor input');await snapshot('workspace');
  await click(['Plugins','插件']);await snapshot('plugins');
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
  if(mode === 'moved'){
    await until(()=>client.evaluate(`document.querySelector('button[aria-label="Enable dsh-portable-acceptance-fixture"],button[aria-label="启用 dsh-portable-acceptance-fixture"]')?.getAttribute('aria-checked')==='false'`),'Moved disabled state reflected in official UI');
    await click(['Enable dsh-portable-acceptance-fixture','启用 dsh-portable-acceptance-fixture']);
    await until(async()=> (await readFile(join(process.env.DSH_HOME,'acceptance-plugin-state.txt'),'utf8'))==='enabled','Moved plugin activation');
    evidence.steps.push('moved plugin activation');
    await click(['View dsh-portable-acceptance-fixture','查看 dsh-portable-acceptance-fixture']);
    await snapshot('detail');
    await click(['Uninstall dsh-portable-acceptance-fixture','卸载 dsh-portable-acceptance-fixture']);
    await click(['Uninstall','卸载'],'[role=dialog] button');
    await until(()=>client.evaluate(`!document.body.innerText.includes('dsh-portable-acceptance-fixture')`),'Moved plugin uninstall');
    evidence.steps.push('moved plugin uninstall');await snapshot('uninstalled');
  }
  await client.evaluate('void window.dshDesktop.updates.open()');await delay(2500);
  evidence.updateTargets=(await targets()).map(({type,url})=>({type,url}));
  await client.evaluate('void window.dshDesktop.updates.status().then(x=>window.__portableUpdateResult=x)');
  await delay(500);evidence.updateStatus=await client.evaluate('window.__portableUpdateResult');
  if(evidence.updateStatus?.phase!=='error'||evidence.updateStatus?.failure!=='check')throw new Error('Official installer updater did not reject the absent update source');
  evidence.passed=true;
  try { await client.send('Browser.close'); } catch(error) { if(!String(error).includes('CDP target closed'))throw error; }
} catch(error){ evidence.error=String(error);process.exitCode=1;try{await snapshot('failure');}catch{} }
finally{ client?.close();await writeFile(output,JSON.stringify(evidence,null,2)); }
