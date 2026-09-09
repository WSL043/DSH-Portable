import test from 'node:test';
import assert from 'node:assert/strict';
import {compareTraffic} from '../scripts/compare-repository-traffic.mjs';
const base={repo:'owner/repo',capturedAt:'2026-09-01T00:00:00Z',stars:2,releases:[{tag:'v1',assets:[{name:'app.zip',downloads:10},{name:'checksums.txt',downloads:100}]}],views:{count:20,uniques:10},referrers:[]};
test('download comparison excludes metadata and does not subtract overlapping visitor windows',()=>{
 const after={...base,capturedAt:'2026-09-08T00:00:00Z',stars:3,views:{count:30,uniques:8},releases:[{tag:'v1',assets:[{name:'app.zip',downloads:13},{name:'checksums.txt',downloads:110}]}]};
 const report=compareTraffic(base,after);
 assert.equal(report.downloads.length,1);assert.equal(report.downloads[0].increment,3);
 assert.equal(report.starChange,1);assert.equal(report.latestRollingWindow.views.uniques,8);
 assert.equal(report.visitorChange,undefined);
});
test('new assets and reset counters are not reported as reliable incremental users',()=>{
 const after={...base,capturedAt:'2026-09-08T00:00:00Z',releases:[{tag:'v1',assets:[{name:'app.zip',downloads:1}]},{tag:'v2',assets:[{name:'app.zip',downloads:5}]}]};
 assert.ok(compareTraffic(base,after).downloads.every(asset=>asset.increment===null));
 assert.throws(()=>compareTraffic(after,base),/older/);
 assert.throws(()=>compareTraffic(base,{...after,repo:'other/repo'}),/same repository/);
});
