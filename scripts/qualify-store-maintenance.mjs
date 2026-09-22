// Isolated retention qualification. Never targets an installed Portable store.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, writeFile, readFile, rename, readdir, lstat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { execFileSync, spawn } from 'node:child_process'
import path from 'node:path'
import { once } from 'node:events'
const mode = process.argv[2] || 'hardlink'
if (!['hardlink', 'copy'].includes(mode)) throw new Error('Expected hardlink or copy')
await mkdir(path.resolve('build'), { recursive: true })
const root = await mkdtemp(path.resolve('build/store-maintenance-' + mode + '-'))
const pnpm = path.resolve('app/node_modules/pnpm/bin/pnpm.cjs')
await mkdir(root,{recursive:true})
const tarballs = {}
for (const version of ['1.0.0','2.0.0']) {
 const dir=path.join(root,version,'package'); await mkdir(dir,{recursive:true})
 await writeFile(path.join(dir,'package.json'),JSON.stringify({name:'portable-storage-fixture',version,main:'index.js'}))
 await writeFile(path.join(dir,'index.js'),`module.exports='${version}'`)
 const tar=path.join(root,version+'.tgz');execFileSync('tar.exe',['-czf',tar,'-C',path.dirname(dir),'package'],{windowsHide:true});tarballs[version]=await readFile(tar)
}
let registry
const server=createServer((req,res)=>{
 if(req.url.endsWith('.tgz')) {const version=req.url.split('/').pop().slice(0,-4);res.end(tarballs[version]);return}
 const versions=Object.fromEntries(['1.0.0','2.0.0'].map(version=>[version,{name:'portable-storage-fixture',version,dist:{integrity:'sha512-'+createHash('sha512').update(tarballs[version]).digest('base64'),tarball:`${registry}/${version}.tgz`}}]))
 res.setHeader('content-type','application/json');res.end(JSON.stringify({name:'portable-storage-fixture','dist-tags':{latest:'2.0.0'},versions}))
})
server.listen(0,'127.0.0.1');await once(server,'listening');registry=`http://127.0.0.1:${server.address().port}`
const store=path.join(root,'store'),profile=path.join(root,'profile');await mkdir(profile,{recursive:true})
const results=[]; const importMethod=mode
async function run(label,args){const child=spawn(process.execPath,[pnpm,...args,'--store-dir',store,'--config.cache-dir='+path.join(root,args[0]==='store'?'maintenance-cache':'cache'),'--registry',registry,...(args[0]==='store'?[]:['--package-import-method='+importMethod])],{cwd:profile,windowsHide:true,env:{...process.env,CI:'true',npm_config_fetch_retries:'0'},stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',d=>log+=d);child.stderr.on('data',d=>log+=d);const timer=setTimeout(()=>child.kill(),45000);const [code]=await once(child,'close');clearTimeout(timer);await writeFile(path.join(root,label+'.log'),log);results.push({label,code});return code}
try {
 for(const version of ['1.0.0','2.0.0']) {
  await writeFile(path.join(profile,'package.json'),JSON.stringify({name:'probe',private:true,dependencies:{'portable-storage-fixture':version}}))
  if(await run('install-'+version,['install','--ignore-scripts','--no-frozen-lockfile'])!==0)throw Error('fixture install failed')
 }
 await new Promise(r=>server.close(r))
 async function measure(dir) {let bytes=0,files=0;for(const entry of await readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory()){const value=await measure(file);bytes+=value.bytes;files+=value.files;}else if(entry.isFile()){bytes+=(await lstat(file)).size;files++;}}return {bytes,files}}
 results.push({label:'baseline',store:await measure(store)});
 // Retain both active and rollback installations, as a conservative control.
 await rename(path.join(profile,'node_modules'),path.join(profile,'node_modules-current'));
 await writeFile(path.join(profile,'package.json'),JSON.stringify({name:'probe',private:true,dependencies:{'portable-storage-fixture':'1.0.0'}}));
 if(await run('prepare-rollback',['install','--offline','--ignore-scripts','--no-frozen-lockfile'])!==0)throw Error('rollback setup failed');
 if(await run('prune-preserve-metadata',['store','prune'])!==0)throw Error('prune failed');
 await rename(path.join(profile,'node_modules'),path.join(profile,'node_modules-rollback'));
 for(const version of ['2.0.0','1.0.0']) {
  await writeFile(path.join(profile,'package.json'),JSON.stringify({name:'probe',private:true,dependencies:{'portable-storage-fixture':version}}));
  const code=await run('offline-rebuild-'+version,['install','--offline','--ignore-scripts','--no-frozen-lockfile','--fetch-retries=0']);
  assert.equal(code, mode === 'hardlink' ? 0 : 1, 'Retention behavior changed; investigate before enabling cleanup');
  if(code===0) await rename(path.join(profile,'node_modules'),path.join(profile,'verified-'+version));
 }
 results.push({label:'final-store',store:await measure(store)});
} finally {server.close();await writeFile(path.join(root,'result.json'),JSON.stringify(results,null,2));console.log(JSON.stringify({mode, output:root, results}))}

