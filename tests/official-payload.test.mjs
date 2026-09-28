import test from 'node:test';
import assert from 'node:assert/strict';
import {compareVersions} from '../experiments/official-payload/version.mjs';
test('official desktop channel never orders prerelease identifiers lexically as numbers',()=>{
  for(const [a,b,expected] of [
    ['0.1.7-rc.2','0.1.7-rc.1',1],['0.1.7','0.1.7-rc.2',1],
    ['0.1.7-alpha.10','0.1.7-alpha.2',1],['0.1.7-rc.2','0.1.7-rc.2',0],
    ['0.1.6','0.1.7-alpha.1',-1],['0.1.7-1','0.1.7-alpha',-1],
    ['0.1.7-alpha','0.1.7-alpha.1',-1]
  ])assert.equal(compareVersions(a,b),expected);
});
test('invalid channel versions cannot become application directory names',()=>{
  for(const value of ['../outside','01.2.3','1.2.3-alpha.01','1.2','1.2.3+unreviewed','x'.repeat(129)])assert.throws(()=>compareVersions(value,'0.1.7'));
});
