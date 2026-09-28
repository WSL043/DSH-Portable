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
import { parseDesktopFeed } from '../experiments/official-payload/feed.mjs';

test('official feed accepts published folded scalars and plain equivalents', () => {
  const plain='version: 0.1.7-rc.2\nfiles:\n  - url: https://download.deepseek.com/dsh-desk/bin/win-x64/example.exe\n    sha512: abc==\n    size: 288245480\n';
  const folded=plain.replace('url: https:', 'url: >-\n      https:').replace('sha512: abc==', 'sha512: >-\n      abc==');
  assert.deepEqual(parseDesktopFeed(plain),parseDesktopFeed(folded));
  assert.equal(parseDesktopFeed(folded.replaceAll('\n','\r\n')).version,'0.1.7-rc.2');
  assert.throws(()=>parseDesktopFeed(folded.replace('      abc==','      abc==\n      extra')),/multiline/);
  assert.throws(()=>parseDesktopFeed(plain+'  - url: https://other.example/a.exe\n'),/layout/);
});
