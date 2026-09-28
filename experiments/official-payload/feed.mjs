// Deliberately accept only the reviewed Electron update-feed subset. Unsupported
// YAML structures stop qualification; they never silently select another asset.
export function parseDesktopFeed(text) {
  if (typeof text !== 'string' || text.length > 32768) throw new Error('Unexpected feed size');
  const scalar = (prefix, indent) => {
    const lines = text.split(/\r?\n/);
    const matches = lines.flatMap((line, i) => line.startsWith(prefix) ? [i] : []);
    if (matches.length !== 1) throw new Error('Official feed layout changed');
    const i = matches[0], value = lines[i].slice(prefix.length).trim();
    if (value !== '>-') {
      if (!/^\S+$/.test(value)) throw new Error('Unsupported feed scalar');
      return value;
    }
    const next = lines[i + 1];
    if (!next?.startsWith(' '.repeat(indent)) || !/^\S+$/.test(next.slice(indent))) throw new Error('Unsupported folded feed scalar');
    if (lines[i + 2]?.startsWith(' '.repeat(indent))) throw new Error('Unexpected multiline feed scalar');
    return next.slice(indent);
  };
  return {version: scalar('version:', 2), url: scalar('  - url:', 6), sha512: scalar('    sha512:', 6), size: Number(scalar('    size:', 6))};
}
