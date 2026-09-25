import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export function adaptHost(input) {
  const sha = createHash('sha256').update(input).digest('hex');
  if (sha !== '4812095a04dc94cddb2297ed3238ba4bf26d6884a0dcdc0b8c79180e54ef98c7') throw new Error('Unreviewed RC2 Desktop host');
  const source = input.toString();
  const before = "args: ['--no-open', '--port', '19387']";
  if (source.split(before).length !== 2) throw new Error('Desktop host port contract changed');
  // WebServer officially supports port 0 and reports the allocated endpoint over IPC.
  // No check-then-bind race, no fallback to another application's service.
  return source.replace(before, "args: ['--no-open', '--port', '0']");
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await writeFile(process.argv[3], adaptHost(await readFile(process.argv[2])), { flag: 'wx' });
}
