// Read public desktop metadata only. Never confuse npm/core releases with desktop artifacts.
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { compareVersions } from './version.mjs';
import { fetchOfficialDesktopCandidate } from './feed.mjs';
const candidate=await fetchOfficialDesktopCandidate();
const {version,sha512}=candidate;
let current;
try{current=JSON.parse(await readFile('channels/official-desktop/windows-x64-v2.json','utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
if(current&&compareVersions(version,current.version)===0&&current.sha512!==sha512)throw new Error('Same-version repack requires an explicit delivery decision');
const changed=!current||compareVersions(version,current.version)>0;
await writeFile('experiments/official-payload/candidate.json',JSON.stringify(candidate,null,2)+'\n');
if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,`changed=${changed}\n`);
console.log(JSON.stringify({version,changed,source:'https://download.deepseek.com/dsh-desk/feeds/win-x64/nightly.yml'}));
