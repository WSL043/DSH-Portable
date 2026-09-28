// Read public desktop metadata only. Never confuse npm/core releases with desktop artifacts.
import { readFile, writeFile, appendFile } from 'node:fs/promises';
const url='https://download.deepseek.com/dsh-desk/feeds/win-x64/nightly.yml';
const response=await fetch(url,{signal:AbortSignal.timeout(15000),redirect:'error'});
if(!response.ok)throw new Error(`Official desktop feed: ${response.status}`);
const text=await response.text();
if(text.length>32768)throw new Error('Unexpected feed size');
const take=pattern=>{const match=text.match(pattern);if(!match)throw new Error('Official feed layout changed');return match[1];};
const version=take(/^version:\s*([^\s]+)\s*$/m);
const file=take(/^\s{2}- url:\s*(https:\/\/\S+)\s*$/m);
const sha512=take(/^\s{4}sha512:\s*(\S+)\s*$/m);
const size=Number(take(/^\s{4}size:\s*(\d+)\s*$/m));
const uri=new URL(file);
if(!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9]+(?:\.[a-zA-Z0-9]+)*)?$/.test(version)||uri.origin!=='https://download.deepseek.com'||!uri.pathname.startsWith('/dsh-desk/bin/win-x64/')||Buffer.from(sha512,'base64').length!==64||!Number.isSafeInteger(size)||size<1000000||size>2147483648)throw new Error('Invalid official candidate identity');
const candidate={schemaVersion:1,version,url:file,size,sha512,publisher:'Hangzhou DeepSeek Artificial Intelligence Co., Ltd.',qualification:'pending',launcherProtocol:1};
let current;
try{current=JSON.parse(await readFile('channels/official-desktop/windows-x64.json','utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
const changed=current?.sha512!==sha512||current?.version!==version;
await writeFile('experiments/official-payload/candidate.json',JSON.stringify(candidate,null,2)+'\n');
if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,`changed=${changed}\n`);
console.log(JSON.stringify({version,changed,source:url}));
