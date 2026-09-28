// Read public desktop metadata only. Never confuse npm/core releases with desktop artifacts.
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { compareVersions } from './version.mjs';
import { parseDesktopFeed } from './feed.mjs';
const url='https://download.deepseek.com/dsh-desk/feeds/win-x64/nightly.yml';
const response=await fetch(url,{signal:AbortSignal.timeout(15000),redirect:'error'});
if(!response.ok)throw new Error(`Official desktop feed: ${response.status}`);
const text=await response.text();
if(text.length>32768)throw new Error('Unexpected feed size');
const {version,url:file,sha512,size}=parseDesktopFeed(text);
const uri=new URL(file);
if(!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9]+(?:\.[a-zA-Z0-9]+)*)?$/.test(version)||uri.origin!=='https://download.deepseek.com'||!uri.pathname.startsWith('/dsh-desk/bin/win-x64/')||Buffer.from(sha512,'base64').length!==64||!Number.isSafeInteger(size)||size<1000000||size>2147483648)throw new Error('Invalid official candidate identity');
const candidate={schemaVersion:1,version,url:file,size,sha512,publisher:'Hangzhou DeepSeek Artificial Intelligence Co., Ltd.',qualification:'pending',launcherProtocol:2};
let current;
try{current=JSON.parse(await readFile('channels/official-desktop/windows-x64-v2.json','utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
if(current&&compareVersions(version,current.version)===0&&current.sha512!==sha512)throw new Error('Same-version repack requires an explicit delivery decision');
const changed=!current||compareVersions(version,current.version)>0;
await writeFile('experiments/official-payload/candidate.json',JSON.stringify(candidate,null,2)+'\n');
if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,`changed=${changed}\n`);
console.log(JSON.stringify({version,changed,source:url}));
