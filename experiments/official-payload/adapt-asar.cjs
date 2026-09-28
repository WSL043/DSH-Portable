// Narrow, audited boundary adapter. No third-party ASAR implementation is shipped.
// Electron treats *.asar as a virtual directory even in RUN_AS_NODE mode.
// Packaging must read and replace the physical archive, not its virtual entries.
const fs = process.versions.electron ? require('original-fs') : require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function adapt(file) {
  const original = fs.readFileSync(file), originalHash = digest(original);
  const headerSize = original.readUInt32LE(4);
  const header = JSON.parse(original.subarray(16, 16 + original.readUInt32LE(12)).toString());
  const entry = header.files.lib.files['main.js'];
  if (!entry || entry.unpacked || entry.link) throw Error('Unsupported official main entry');
  const start = 8 + headerSize + Number(entry.offset);
  const input = original.subarray(start, start + entry.size).toString('utf8');
  const substitutions = [
    ['const updates = new DesktopUpdateCoordinator(publishUpdate, async () => {', 'const updates = new (portableCoordinator(DesktopUpdateCoordinator, app))(publishUpdate, async () => {'],
    ['if (app.isPackaged || process.env.DSH_DESKTOP_DEV_APP === "1") app.setAsDefaultProtocolClient("dsh");', 'configurePortableProtocol(app);'],
    ['await manager.applyRelease();', 'const freshPortableProfile = await portableProfileIsFresh(manager.paths.profile);\n\t\t\t\tawait manager.applyRelease();\n\t\t\t\tawait seedPortableDefaults(manager.paths.profile, freshPortableProfile);'],
  ];
  let source = input;
  for (const [from, to] of substitutions) {
    if (source.split(from).length !== 2) throw Error('Official desktop boundary changed; qualification required');
    source = source.replace(from, to);
  }
  source = 'import { portableCoordinator, configurePortableProtocol, seedPortableDefaults, portableProfileIsFresh } from "../../../../../launcher/desktop-adapter.mjs";\n' + source;
  const replacement = Buffer.from(source), delta = replacement.length - entry.size;
  const oldEnd = Number(entry.offset) + entry.size;
  function rebase(files) {
    for (const value of Object.values(files)) {
      if (value.files) rebase(value.files);
      else if (!value.unpacked && value.offset !== undefined && value !== entry && Number(value.offset) >= oldEnd) value.offset = String(Number(value.offset) + delta);
    }
  }
  rebase(header.files);
  entry.size = replacement.length;
  if (entry.integrity) {
    if (entry.integrity.algorithm !== 'SHA256' || !Number.isInteger(entry.integrity.blockSize) || entry.integrity.blockSize <= 0) throw Error('Unsupported ASAR integrity');
    entry.integrity.hash = digest(replacement);
    entry.integrity.blocks = [];
    for (let i = 0; i < replacement.length; i += entry.integrity.blockSize) entry.integrity.blocks.push(digest(replacement.subarray(i, i + entry.integrity.blockSize)));
  }
  const json = Buffer.from(JSON.stringify(header)), payloadSize = 4 + ((json.length + 3) & ~3);
  const prefix = Buffer.alloc(8 + 4 + payloadSize);
  prefix.writeUInt32LE(4, 0); prefix.writeUInt32LE(4 + payloadSize, 4);
  prefix.writeUInt32LE(payloadSize, 8); prefix.writeUInt32LE(json.length, 12); json.copy(prefix, 16);
  const output = Buffer.concat([prefix, original.subarray(8 + headerSize, start), replacement, original.subarray(start + (replacement.length - delta))]);
  fs.writeFileSync(file + '.adapted', output, {flag: 'wx'});
  fs.renameSync(file + '.adapted', file);
  return { adapterProtocol: 2, originalAsarSha256: originalHash, asarSha256: digest(output), originalMainSha256: digest(Buffer.from(input)), adaptedMainSha256: digest(replacement) };
}
module.exports = { adapt };
if (require.main === module) fs.writeFileSync(process.argv[3], JSON.stringify(adapt(path.resolve(process.argv[2])), null, 2));
