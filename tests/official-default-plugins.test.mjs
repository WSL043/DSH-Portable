import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {seedDefaults,isFreshProfile} from '../experiments/official-payload/default-plugins.mjs';

test('default seeding preserves an existing profile, including intentional empty dependencies',async()=>{
  const root=await mkdtemp(join(tmpdir(),'portable-default-existing-'));
  try{
    const profile=join(root,'data/dsh-home/profiles/desktop');
    await mkdir(profile,{recursive:true});await mkdir(join(root,'data/launcher'),{recursive:true});
    const content=JSON.stringify({dependencies:{},dsh:{profile:{bundles:[]}}});
    await writeFile(join(profile,'package.json'),content);
    assert.equal(await isFreshProfile(profile),false);
    await seedDefaults(root,profile,'must-not-launch','missing-runtime',false);
    assert.equal(await readFile(join(profile,'package.json'),'utf8'),content);
    assert.equal(JSON.parse(await readFile(join(root,'data/launcher/default-plugins.json'),'utf8')).status,'existing-profile-preserved');
  }finally{await rm(root,{recursive:true,force:true});}
});
test('an initialized profile never restores defaults after uninstall or disable',async()=>{
  const root=await mkdtemp(join(tmpdir(),'portable-default-disabled-'));
  try{
    const profile=join(root,'data/dsh-home/profiles/desktop');
    await mkdir(join(root,'data/launcher'),{recursive:true});
    await writeFile(join(root,'data/launcher/default-plugins.json'),JSON.stringify({schemaVersion:1,status:'initialized'}));
    await seedDefaults(root,profile,'must-not-launch','missing-runtime',true);
    await assert.rejects(()=>seedDefaults(root,join(root,'outside'),'','',true),/boundary changed/);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('fresh profile initialization records defaults only after an offline install succeeds',async()=>{
  const root=await mkdtemp(join(tmpdir(),'portable-default-first-'));
  try {
    const profile=join(root,'data/dsh-home/profiles/desktop');
    const resources=join(root,'resources');
    await mkdir(profile,{recursive:true});
    await mkdir(join(root,'data/launcher'),{recursive:true});
    await mkdir(join(root,'launcher/default-plugins/store'),{recursive:true});
    await mkdir(join(root,'launcher/default-plugins/cache'),{recursive:true});
    await mkdir(join(resources,'runtime/pnpm/bin'),{recursive:true});
    await writeFile(join(profile,'package.json'),JSON.stringify({dependencies:{},dsh:{profile:{bundles:['official-bundle']}}}));
    const script=join(resources,'runtime/pnpm/bin/pnpm.mjs');
    await writeFile(script,'process.exit(1);');
    await assert.rejects(()=>seedDefaults(root,profile,process.execPath,resources,true),/initialization failed/);
    const marker=join(root,'data/launcher/default-plugins.json');
    assert.equal(JSON.parse(await readFile(marker,'utf8')).status,'pending');
    await writeFile(script,`import fs from 'node:fs';
      if(!process.argv.includes('--offline')||!process.argv.includes('--ignore-scripts'))process.exit(2);
      const p=JSON.parse(fs.readFileSync('package.json','utf8'));
      p.dependencies={'dsh-chat-manager':process.argv[3],'@wsl043/dsh-portable-plugin-market':process.argv[4]};
      fs.writeFileSync('package.json',JSON.stringify(p));`);
    // Retry after a failed first start sees an existing profile but must finish its pending operation.
    await seedDefaults(root,profile,process.execPath,resources,false);
    const profileData=JSON.parse(await readFile(join(profile,'package.json'),'utf8'));
    assert.deepEqual(profileData.dsh.profile.bundles,['official-bundle','dsh-chat-manager','@wsl043/dsh-portable-plugin-market']);
    assert.equal(Object.keys(profileData.dependencies).length,2);
    assert.equal(JSON.parse(await readFile(marker,'utf8')).status,'initialized');
  } finally {await rm(root,{recursive:true,force:true});}
});
