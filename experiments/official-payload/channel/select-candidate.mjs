import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CHANNEL_INDEX_URL } from './constants.mjs';

export async function selectCandidate({ requestedVersion = '', outputDirectory }) {
  if (!outputDirectory) throw new Error('Output directory is required');
  const response = await fetch(CHANNEL_INDEX_URL, { redirect: 'follow', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Production channel index returned ${response.status}`);
  const text = await response.text();
  if (text.length > 1_048_576) throw new Error('Production channel index is too large');
  const index = JSON.parse(text);
  if (index.schemaVersion !== 1 || !Array.isArray(index.versions) || index.versions.length === 0) throw new Error('Production channel has no qualified versions');
  const candidate = requestedVersion ? index.versions.find(item => item.version === requestedVersion) : index.versions.at(-1);
  if (!candidate) throw new Error(`Requested version ${requestedVersion} is absent from the accepted channel`);
  const directory = resolve(outputDirectory);
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
  await writeFile(resolve(directory, 'candidate.json'), `${JSON.stringify(candidate, null, 2)}\n`);
  return candidate;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [first, second] = process.argv.slice(2);
  const requestedVersion = second === undefined ? '' : (first ?? '');
  const outputDirectory = second ?? first;
  const candidate = await selectCandidate({ requestedVersion, outputDirectory });
  console.log(JSON.stringify({ version: candidate.version, installerUrl: candidate.installerUrl }));
}
