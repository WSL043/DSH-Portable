import { pathToFileURL } from 'node:url';

export const CHANNEL_BASE_URL = 'https://github.com/WSL043/DSH-Portable/releases/download/update-channel-desktop/';
export const CHANNEL_INDEX_URL = `${CHANNEL_BASE_URL}index.json`;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify({ channelBaseUrl: CHANNEL_BASE_URL, indexUrl: CHANNEL_INDEX_URL }));
}
