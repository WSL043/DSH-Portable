import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { PortableUpdater } from '../experiments/official-payload/update-bridge.mjs';
const {adapt}=createRequire(import.meta.url)('../experiments/official-payload/adapt-asar.cjs');

test('ASAR adaptation changes only intended boundaries and rejects repeat/ambiguous input', () => {
  const directory=mkdtempSync(join(tmpdir(),'portable-asar-contract-'));
  try {
    const main='const updates = new DesktopUpdateCoordinator(publishUpdate, async () => {\n});\nif (app.isPackaged || process.env.DSH_DESKTOP_DEV_APP === "1") app.setAsDefaultProtocolClient("dsh");\nawait manager.applyRelease();';
    const market=Buffer.from('"plugins.bundle.config": {\n}\nclassName: PluginManagerPage_module_css_default.toolbar,\n\t\t\t\t\t\t\tchildren: []');
    const tail=Buffer.from('unchanged payload'), bytes=Buffer.from(main);
    const header={files:{lib:{files:{'main.js':{offset:'0',size:bytes.length}}},dsh:{files:{node_modules:{files:{'@deepseek-ai':{files:{'dsh-client-ui-plugin-manager':{files:{lib:{files:{'client.js':{offset:String(bytes.length),size:market.length}}}}}}}}}}},'tail.bin':{offset:String(bytes.length+market.length),size:tail.length}}};
    const json=Buffer.from(JSON.stringify(header)), size=4+((json.length+3)&~3), prefix=Buffer.alloc(12+size);
    prefix.writeUInt32LE(4,0);prefix.writeUInt32LE(size+4,4);prefix.writeUInt32LE(size,8);prefix.writeUInt32LE(json.length,12);json.copy(prefix,16);
    const file=join(directory,'app.asar');writeFileSync(file,Buffer.concat([prefix,bytes,market,tail]));
    const receipt=adapt(file), output=readFileSync(file), next=JSON.parse(output.subarray(16,16+output.readUInt32LE(12)));
    const offset=8+output.readUInt32LE(4)+Number(next.files['tail.bin'].offset);
    assert.deepEqual(output.subarray(offset),tail);
    assert.equal(receipt.adapterProtocol,2);
    assert.notEqual(receipt.originalAsarSha256,receipt.asarSha256);
    assert.notEqual(receipt.originalPluginManagerSha256,receipt.adaptedPluginManagerSha256);
    assert.ok(output.includes(Buffer.from('renderSlot("plugins.portable.actions", { refresh: props.refresh, openInstall: props.openInstall, editInstallSpec: props.editInstallSpec })')));
    assert.throws(()=>adapt(file),/boundary changed/);
  } finally {rmSync(directory,{recursive:true,force:true});}
});

function updater(statuses) {
  const invocations=[];let index=-1;
  const instance=new PortableUpdater('C:\\portable',{getVersion:()=> '0.1.7-rc.1'}, {
    spawn: (exe,args) => {invocations.push(args);index++;const child=new EventEmitter();queueMicrotask(()=>child.emit('exit',0));return child;},
    readFile:async()=>JSON.stringify(statuses[index]),
  });
  return {instance,invocations};
}
test('official update transport checks without downloading and prepares the confirmed version', async()=>{
  const {instance,invocations}=updater([{status:'available',version:'0.1.7-rc.2'},{status:'ready',version:'0.1.7-rc.2'}]);
  assert.equal((await instance.checkForUpdates()).isUpdateAvailable,true);
  let ready;instance.on('update-downloaded',value=>ready=value);
  await instance.downloadUpdate();assert.equal(ready.version,'0.1.7-rc.2');
  assert.ok(invocations[0].includes('Check'));assert.ok(!invocations[0].includes('Prepare'));
  assert.ok(invocations[1].includes('-ExpectedVersion'));assert.ok(invocations[1].includes('0.1.7-rc.2'));
});
test('current state, failures and mismatched prepared targets remain distinct',async()=>{
  assert.equal((await updater([{status:'current',version:'0.1.7-rc.1'}]).instance.checkForUpdates()).isUpdateAvailable,false);
  await assert.rejects(updater([{status:'failed',error:'network unavailable'}]).instance.checkForUpdates(),/network unavailable/);
  const {instance}=updater([{status:'available',version:'0.1.7-rc.2'},{status:'ready',version:'0.1.7-rc.3'}]);
  await instance.checkForUpdates();await assert.rejects(instance.downloadUpdate(),/not prepared/);
});
test('install handoff only quits after the restart helper successfully starts',()=>{
  let quit=0,unref=0;const child=new EventEmitter();child.unref=()=>unref++;
  const instance=new PortableUpdater('C:\\portable',{quit:()=>quit++,commandLine:{getSwitchValue:()=>''}}, {spawn:(exe,args)=>{assert.ok(args[0].startsWith('--restart-after='));return child;}});
  instance.quitAndInstall();assert.equal(quit,0);child.emit('spawn');assert.equal(quit,1);assert.equal(unref,1);
});
