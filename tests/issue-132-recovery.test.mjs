import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,realpath,lstat,rename} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
const core=await import(process.env.ISSUE132_CORE ? pathToFileURL(path.resolve(process.env.ISSUE132_CORE)) : '../launcher/portable-core.mjs');
for(const mode of ['materialized','empty','unknown','file']) test(`bridge recovery: ${mode}`,async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'dsh-132-test-'));
 const l=core.layoutForRoot(root);const target=path.dirname(l.desktopBridgePatch);
 await mkdir(target,{recursive:true});await writeFile(path.join(target,'package.json'),'{"name":"@wsl043/dsh-portable-desktop-bridge"}');
 await mkdir(path.dirname(l.desktopBridgeFallback),{recursive:true});
 if(mode==='file') await writeFile(l.desktopBridgeFallback,'keep');
 else {await mkdir(l.desktopBridgeFallback);if(mode!=='empty')await writeFile(path.join(l.desktopBridgeFallback,'package.json'),JSON.stringify({name:mode==='materialized'?'@wsl043/dsh-portable-desktop-bridge':'unknown'}));}
 if(mode==='unknown'||mode==='file') {await assert.rejects(core.ensureDesktopBridgeFallback(l),/preserved unchanged/); assert.equal((await lstat(l.desktopBridgeFallback)).isSymbolicLink(),false);return;}
 assert.equal(await core.ensureDesktopBridgeFallback(l),true);
 assert.equal(await realpath(l.desktopBridgeFallback),await realpath(target));
 const recovery=path.join(l.dataDir,'recovery','managed-packages');const entries=await readdir(recovery);assert.equal(entries.length,1);
 const record=JSON.parse(await readFile(path.join(recovery,entries[0],'recovery.json'),'utf8'));assert.equal(record.fallback,l.desktopBridgeFallback);
 if(mode==='materialized')assert.match(await readFile(path.join(record.backup,'package.json'),'utf8'),/dsh-portable-desktop-bridge/);
 assert.equal(await core.ensureDesktopBridgeFallback(l),false);
 const moved=root+'-moved';await rename(root,moved);const m=core.layoutForRoot(moved);await core.ensureDesktopBridgeFallback(m);assert.equal(await realpath(m.desktopBridgeFallback),await realpath(path.dirname(m.desktopBridgePatch)));
});
