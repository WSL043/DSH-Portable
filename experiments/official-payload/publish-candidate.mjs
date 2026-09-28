// Publish only the identity qualified by this workflow; official binaries remain on their CDN.
import { readFile } from 'node:fs/promises';
import { compareVersions } from './version.mjs';
const candidate=JSON.parse((await readFile('build/official-payload-evidence/qualified-candidate.json','utf8')).replace(/^\uFEFF/,''));
if(candidate.qualification!=='qualified'||candidate.launcherProtocol!==2||!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9]+(?:\.[a-zA-Z0-9]+)*)?$/.test(candidate.version)||candidate.evidence!==`https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`)throw new Error('Qualification identity mismatch');
const endpoint=`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/contents/channels/official-desktop/windows-x64-v2.json`;
const headers={Authorization:`Bearer ${process.env.GITHUB_TOKEN}`,Accept:'application/vnd.github+json','Content-Type':'application/json'};
const previous=await fetch(`${endpoint}?ref=main`,{headers,signal:AbortSignal.timeout(15000)});
let sha;
if(previous.ok){
  const entry=await previous.json();sha=entry.sha;
  const current=JSON.parse(Buffer.from(entry.content,'base64').toString('utf8').replace(/^\uFEFF/,''));
  if(current.version===candidate.version&&current.sha512===candidate.sha512){console.log('Qualified identity unchanged');process.exit(0);}
  if(current.version===candidate.version)throw new Error('Same-version repack requires an explicit delivery decision');
  if(compareVersions(candidate.version,current.version)<=0)throw new Error('Refusing channel regression');
}else if(previous.status!==404)throw new Error(`Cannot read channel: ${previous.status}`);
const result=await fetch(endpoint,{method:'PUT',headers,signal:AbortSignal.timeout(15000),body:JSON.stringify({message:`chore(desktop): qualify official desktop ${candidate.version}`,content:Buffer.from(JSON.stringify(candidate,null,2)+'\n').toString('base64'),branch:'main',...(sha?{sha}:{})})});
if(!result.ok)throw new Error(`Channel publication failed: ${result.status}`);
console.log(`Published qualified official desktop ${candidate.version}`);
