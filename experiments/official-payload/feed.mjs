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

export async function fetchOfficialDesktopCandidate(channel = 'nightly', fetchImpl = fetch) {
  if (channel !== 'nightly' && channel !== 'stable') throw new Error('Unsupported official Desktop channel');
  const feedUrl = `https://download.deepseek.com/dsh-desk/feeds/win-x64/${channel}.yml`;
  const response = await fetchImpl(feedUrl, { signal: AbortSignal.timeout(15000), redirect: 'error' });
  if (channel === 'stable' && response.status === 404) return null;
  if (!response.ok) throw new Error(`Official Desktop ${channel} feed: ${response.status}`);
  const { version, url, sha512, size } = parseDesktopFeed(await response.text());
  const uri = new URL(url);
  const versionPattern = channel === 'stable' ? /^\d+\.\d+\.\d+$/ : /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9]+(?:\.[a-zA-Z0-9]+)*)?$/;
  const digest = Buffer.from(sha512, 'base64');
  if (!versionPattern.test(version) || uri.origin !== 'https://download.deepseek.com'
    || !uri.pathname.startsWith('/dsh-desk/bin/win-x64/') || uri.username || uri.password
    || digest.length !== 64 || digest.toString('base64') !== sha512
    || !Number.isSafeInteger(size) || size < 1000000 || size > 2147483648) {
    throw new Error(`Invalid official Desktop ${channel} candidate identity`);
  }
  return { schemaVersion: 1, version, url, size, sha512, publisher: 'Hangzhou DeepSeek Artificial Intelligence Co., Ltd.', qualification: 'pending', launcherProtocol: 2 };
}
