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
