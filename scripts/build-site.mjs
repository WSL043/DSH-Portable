import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { runInNewContext } from "node:vm";

const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, "build", "site");

await rm(output, { recursive: true, force: true });
await mkdir(path.join(output, "assets"), { recursive: true });
await cp(path.join(root, "site"), output, { recursive: true });

for (const asset of ["DSH-Portable.svg", "DSH-Portable-white.svg", "DSH-Portable-512.png", "dsh-interface-zh.png", "dsh-interface-en.png", "hero-atmosphere.png", "viewer-dark.png", "windows-navigation-dark.png", "dsh-workspace-0.6.4.png"]) {
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
  ['<meta name="description" content="DSH-Portable：自带运行环境和插件市场的 DeepSeek Harness 桌面版，界面安装插件，会话与默认工作区随文件夹移动。">', '<meta name="description" content="DSH-Portable brings a bundled runtime and visual plugin market to DeepSeek Harness, with sessions and the default workspace in a movable folder.">'],
  ['<meta property="og:title" content="DSH-Portable｜可移动的 DeepSeek Harness 桌面版">', '<meta property="og:title" content="DSH-Portable | Portable DeepSeek Harness desktop">'],
  ['<meta property="og:description" content="自带运行环境和插件市场，界面安装插件；会话、设置与默认工作区方便移动和备份。">', '<meta property="og:description" content="Bundled runtime and visual plugin installation. Keep sessions, settings, and the default workspace together for moving and backup.">'],
  ['<meta property="og:url" content="https://wsl043.github.io/DSH-Portable/">', '<meta property="og:url" content="https://wsl043.github.io/DSH-Portable/en/">'],
  ['<meta property="og:locale" content="zh_CN">', '<meta property="og:locale" content="en_US">'],
  ['<meta property="og:image" content="https://wsl043.github.io/DSH-Portable/assets/dsh-interface-zh.png">', '<meta property="og:image" content="https://wsl043.github.io/DSH-Portable/assets/dsh-interface-en.png">'],
  ['<meta name="twitter:title" content="DSH-Portable｜可移动的 DeepSeek Harness 桌面版">', '<meta name="twitter:title" content="DSH-Portable | Portable DeepSeek Harness desktop">'],
  ['<meta name="twitter:description" content="自带运行环境和插件市场，界面安装插件；会话、设置与默认工作区方便移动和备份。">', '<meta name="twitter:description" content="Bundled runtime and visual plugin installation. Keep sessions, settings, and the default workspace together for moving and backup.">'],
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
// Render translated content into HTML as well, so English readers and crawlers
// get the same page without waiting for client-side JavaScript.
const clientSource = await readFile(path.join(root, "site/app.js"), "utf8");
const dictionarySource = clientSource.slice(clientSource.indexOf("const copy ="), clientSource.indexOf("const zhCopy"));
const translations = runInNewContext(`${dictionarySource}; copy.en`, {}, { timeout: 1000 });
english = english.replace(/<([a-z][a-z0-9]*)\b([^>]*\bdata-i18n="([^"]+)"[^>]*)>[\s\S]*?<\/\1>/gi,
  (original, tag, attributes, key) => translations[key] === undefined ? original : `<${tag}${attributes}>${translations[key]}</${tag}>`);
await writeFile(path.join(output, "en", "index.html"), english);

// Version the entry assets together so a cached old script cannot run against new markup.
const sceneSource = await readFile(path.join(output, "scene.js"), "utf8");
const styleSource = await readFile(path.join(output, "styles.css"), "utf8");
const revision = createHash("sha256").update(clientSource).update(sceneSource).update(styleSource).digest("hex").slice(0, 12);
await writeFile(path.join(output, "app.js"), clientSource.replace('import("./scene.js")', `import("./scene.js?v=${revision}")`));
for (const route of ["index.html", "en/index.html"]) {
  const file = path.join(output, route);
  const source = await readFile(file, "utf8");
  await writeFile(file, source.replace(/(href="(?:\.\.\/)?styles\.css|src="(?:\.\.\/)?app\.js)"/g, `$1?v=${revision}"`));
}
console.log(`Website staged at ${output}`);
