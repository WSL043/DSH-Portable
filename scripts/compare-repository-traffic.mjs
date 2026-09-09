import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
export function compareTraffic(before, after) {
  if (before.repo !== after.repo) throw new Error('Snapshots must belong to the same repository');
  if (!(Date.parse(after.capturedAt) > Date.parse(before.capturedAt))) throw new Error('Pass the older snapshot first');
  const packages = /\.(exe|zip|AppImage|tar\.gz)$/;
  const old = new Map(before.releases.flatMap(release => release.assets.map(asset => [`${release.tag}/${asset.name}`,asset.downloads])));
  const downloads = after.releases.flatMap(release => release.assets.filter(asset => packages.test(asset.name)).map(asset => {
    const key = `${release.tag}/${asset.name}`, previous = old.get(key);
    return { tag:release.tag, asset:asset.name, count:asset.downloads,
      increment:previous === undefined || asset.downloads < previous ? null : asset.downloads-previous,
      note:previous === undefined ? 'Newly observed asset; no comparable baseline' : asset.downloads < previous ? 'Counter decreased; asset may have been replaced' : 'Same named asset; includes repeats and automation' };
  }));
  return {repo:after.repo,from:before.capturedAt,to:after.capturedAt,stars:after.stars,starChange:after.stars-before.stars,downloads,
    latestRollingWindow:{views:after.views,referrers:after.referrers},
    interpretation:'Rolling windows overlap and may lag. Do not subtract unique visitor counts or infer installs, conversion, or retention. Download counters include repeat and automated requests.'};
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [older,newer] = process.argv.slice(2);
  if(!older||!newer) throw new Error('Usage: node scripts/compare-repository-traffic.mjs <older.json> <newer.json>');
  const report=compareTraffic(JSON.parse(await readFile(older,'utf8')),JSON.parse(await readFile(newer,'utf8')));
  console.log(JSON.stringify(report,null,2));
}
