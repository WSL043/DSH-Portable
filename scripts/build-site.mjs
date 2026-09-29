import { buildGuides } from "./build-site-guides.mjs";
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
  ['<meta name="description" content="DSH-Portable 是 DeepSeek Harness 的便携版：一个文件夹带走会话、设置、插件和工作区；支持同平台整夹迁移与保留数据的更新恢复。">', '<meta name="description" content="DSH-Portable is the portable edition of DeepSeek Harness: take sessions, settings, plugins, and your workspace in one folder. Stable 0.x supports Windows, macOS, and Linux; the 1.0 development line is Windows-only, and its builds and drafts are not public downloads.">'],
  ['<meta property="og:title" content="DSH-Portable｜DeepSeek Harness 便携版">', '<meta property="og:title" content="DSH-Portable | Portable DeepSeek Harness">'],
  ['<meta property="og:description" content="一个文件夹带走会话、设置、插件和工作区；Portable 与内核分开更新，并提供保留数据的回滚与恢复工具。独立社区项目，非 DeepSeek 官方应用。">', '<meta property="og:description" content="One folder for sessions, settings, plugins, and your workspace. Portable and core update separately, with data-preserving rollback and recovery tools. An independent community project, not an official DeepSeek app.">'],
  ['<meta property="og:url" content="https://wsl043.github.io/DSH-Portable/">', '<meta property="og:url" content="https://wsl043.github.io/DSH-Portable/en/">'],
  ['<meta property="og:locale" content="zh_CN">', '<meta property="og:locale" content="en_US">'],
  ['<meta property="og:image" content="https://wsl043.github.io/DSH-Portable/assets/dsh-interface-zh.png">', '<meta property="og:image" content="https://wsl043.github.io/DSH-Portable/assets/dsh-interface-en.png">'],
  ['<meta name="twitter:title" content="DSH-Portable｜DeepSeek Harness 便携版">', '<meta name="twitter:title" content="DSH-Portable | Portable DeepSeek Harness">'],
  ['<meta name="twitter:description" content="一个文件夹带走会话、设置、插件和工作区；Portable 与内核分开更新，并提供保留数据的回滚与恢复工具。独立社区项目，非 DeepSeek 官方应用。">', '<meta name="twitter:description" content="One folder for sessions, settings, plugins, and your workspace. Portable and core update separately, with data-preserving rollback and recovery tools. An independent community project, not an official DeepSeek app.">'],
  ['<meta name="twitter:image" content="https://wsl043.github.io/DSH-Portable/assets/dsh-interface-zh.png">', '<meta name="twitter:image" content="https://wsl043.github.io/DSH-Portable/assets/dsh-interface-en.png">'],
  ['<link rel="canonical" href="https://wsl043.github.io/DSH-Portable/">', '<link rel="canonical" href="https://wsl043.github.io/DSH-Portable/en/">'],
  ['"description": "DeepSeek Harness 的便携版：一个文件夹带走会话、设置、插件和工作区。稳定版 0.x 支持 Windows、macOS 和 Linux；1.0 开发线仅 Windows，仍为开发构建与草稿。"', '"description": "The portable edition of DeepSeek Harness: take sessions, settings, plugins, and your workspace in one folder. Stable 0.x supports Windows, macOS, and Linux; the 1.0 development line is Windows-only, with development builds and drafts outside public downloads."'],
  ['"url": "https://wsl043.github.io/DSH-Portable/"', '"url": "https://wsl043.github.io/DSH-Portable/en/"'],
  ['"screenshot": "https://wsl043.github.io/DSH-Portable/assets/dsh-interface-zh.png"', '"screenshot": "https://wsl043.github.io/DSH-Portable/assets/dsh-interface-en.png"'],
  ['"softwareRequirements": "稳定版 0.x：Windows、macOS 和 Linux；1.0 开发线：仅 Windows 开发构建与草稿，不在公开下载中。"', '"softwareRequirements": "Stable 0.x: Windows, macOS, and Linux; 1.0 development line: Windows-only development builds and drafts, outside public downloads."'],
  ['<title>DSH-Portable｜DeepSeek Harness 的便携版</title>', '<title>DSH-Portable | Portable DeepSeek Harness in a folder</title>'],
  ['<a class="language-switch" href="en/" hreflang="en" lang="en" aria-label="Switch to English" data-language-switch>EN</a>', '<a class="language-switch" href="../" hreflang="zh-CN" lang="zh-CN" aria-label="切换到中文" data-language-switch>中</a>'],
  ['src="assets/dsh-interface-zh.png"', 'src="../assets/dsh-interface-en.png"']
]) english = replaceRequired(english, from, to);

english = english
  .replaceAll('href="assets/', 'href="../assets/')
  .replaceAll('href="guides/', 'href="../guides/')
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
const guideSource = await readFile(path.join(output, "guide.js"), "utf8");
const revision = createHash("sha256").update(clientSource).update(sceneSource).update(styleSource).update(guideSource).digest("hex").slice(0, 12);
await writeFile(path.join(output, "app.js"), clientSource.replace('import("./scene.js")', `import("./scene.js?v=${revision}")`));
for (const route of ["index.html", "en/index.html"]) {
  const file = path.join(output, route);
  const source = await readFile(file, "utf8");
  await writeFile(file, source.replace(/(href="(?:\.\.\/)?styles\.css|src="(?:\.\.\/)?app\.js)"/g, `$1?v=${revision}"`));
}
await buildGuides(root, output, revision);
console.log(`Website staged at ${output}`);
