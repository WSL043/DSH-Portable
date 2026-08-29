import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, "build", "site");

await rm(output, { recursive: true, force: true });
await mkdir(path.join(output, "assets"), { recursive: true });
await cp(path.join(root, "site"), output, { recursive: true });

for (const asset of ["DSH-Portable.svg", "DSH-Portable-white.svg", "DSH-Portable-512.png", "dsh-interface-zh.png", "dsh-interface-en.png", "hero-atmosphere.png"]) {
  await cp(path.join(root, "assets", asset), path.join(output, "assets", asset));
}

function replaceRequired(source, from, to) {
  if (!source.includes(from)) throw new Error(`English site transform could not find: ${from}`);
  return source.replace(from, to);
}

let english = await readFile(path.join(output, "index.html"), "utf8");
for (const [from, to] of [
  ['<html lang="zh-CN">', '<html lang="en">'],
  ['<meta name="dsh-page-language" content="zh">', '<meta name="dsh-page-language" content="en">'],
  ['<meta name="description" content="DSH-Portable：无需 Node.js 的可移动 DeepSeek Harness 桌面版，会话、设置、插件和工作区随文件夹一起移动。">', '<meta name="description" content="DSH-Portable is a portable DeepSeek Harness desktop distribution with no separate Node.js install; sessions, settings, plugins, and workspace move with the folder.">'],
  ['<meta property="og:title" content="DSH-Portable｜可移动的 DeepSeek Harness 桌面版">', '<meta property="og:title" content="DSH-Portable | Portable DeepSeek Harness desktop">'],
  ['<meta property="og:description" content="无需 Node.js；会话、设置、插件和工作区随文件夹一起移动。">', '<meta property="og:description" content="No Node.js required; sessions, settings, plugins, and workspace move with the folder.">'],
  ['<meta property="og:url" content="https://wsl043.github.io/DSH-Portable/">', '<meta property="og:url" content="https://wsl043.github.io/DSH-Portable/en/">'],
  ['<meta property="og:locale" content="zh_CN">', '<meta property="og:locale" content="en_US">'],
  ['<meta property="og:image" content="https://wsl043.github.io/DSH-Portable/assets/dsh-interface-zh.png">', '<meta property="og:image" content="https://wsl043.github.io/DSH-Portable/assets/dsh-interface-en.png">'],
  ['<meta name="twitter:title" content="DSH-Portable｜可移动的 DeepSeek Harness 桌面版">', '<meta name="twitter:title" content="DSH-Portable | Portable DeepSeek Harness desktop">'],
  ['<meta name="twitter:description" content="无需 Node.js；会话、设置、插件和工作区随文件夹一起移动。">', '<meta name="twitter:description" content="No Node.js required; sessions, settings, plugins, and workspace move with the folder.">'],
  ['<meta name="twitter:image" content="https://wsl043.github.io/DSH-Portable/assets/dsh-interface-zh.png">', '<meta name="twitter:image" content="https://wsl043.github.io/DSH-Portable/assets/dsh-interface-en.png">'],
  ['<link rel="canonical" href="https://wsl043.github.io/DSH-Portable/">', '<link rel="canonical" href="https://wsl043.github.io/DSH-Portable/en/">'],
  ['"description": "无需 Node.js 的可移动 DeepSeek Harness 社区桌面发行版，支持 Windows、macOS 和 Linux。"', '"description": "A portable community desktop distribution of DeepSeek Harness for Windows, macOS, and Linux, with no separate Node.js install."'],
  ['"url": "https://wsl043.github.io/DSH-Portable/"', '"url": "https://wsl043.github.io/DSH-Portable/en/"'],
  ['"screenshot": "https://wsl043.github.io/DSH-Portable/assets/dsh-interface-zh.png"', '"screenshot": "https://wsl043.github.io/DSH-Portable/assets/dsh-interface-en.png"'],
  ['"softwareRequirements": "无需单独安装 Node.js"', '"softwareRequirements": "No separate Node.js installation required"'],
  ['<title>DSH-Portable｜无需 Node.js 的可移动 DeepSeek Harness 桌面版</title>', '<title>DSH-Portable | Portable DeepSeek Harness desktop</title>'],
  ['<a class="language-switch" href="en/" hreflang="en" lang="en" aria-label="Switch to English" data-language-switch>EN</a>', '<a class="language-switch" href="../" hreflang="zh-CN" lang="zh-CN" aria-label="切换到中文" data-language-switch>中</a>'],
  ['src="assets/dsh-interface-zh.png"', 'src="../assets/dsh-interface-en.png"']
]) english = replaceRequired(english, from, to);

english = english
  .replaceAll('href="assets/', 'href="../assets/')
  .replaceAll('src="assets/', 'src="../assets/')
  .replace('href="styles.css"', 'href="../styles.css"')
  .replace('src="app.js"', 'src="../app.js"');

await mkdir(path.join(output, "en"), { recursive: true });
await writeFile(path.join(output, "en", "index.html"), english);

console.log(`Website staged at ${output}`);
