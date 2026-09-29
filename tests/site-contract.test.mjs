import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const repositoryRoot = new URL("../", import.meta.url);

const html = await readFile(new URL("../site/index.html", import.meta.url), "utf8");
const app = await readFile(new URL("../site/app.js", import.meta.url), "utf8");
const css = await readFile(new URL("../site/styles.css", import.meta.url), "utf8");
const cname = new URL("../site/CNAME", import.meta.url);
const robots = await readFile(new URL("../site/robots.txt", import.meta.url), "utf8");
const sitemap = await readFile(new URL("../site/sitemap.xml", import.meta.url), "utf8");
const workflow = await readFile(new URL("../.github/workflows/pages.yml", import.meta.url), "utf8");
const privacy = await readFile(new URL("../PRIVACY.md", import.meta.url), "utf8");
const signing = await readFile(new URL("../CODE_SIGNING.md", import.meta.url), "utf8");
const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
const readmeEnglish = await readFile(new URL("../README.en.md", import.meta.url), "utf8");

test("website uses only stable release asset names that the product publishes", () => {
  const assets = [
    "DSH-Portable-windows-x64.exe",
    "DSH-Portable-windows-x64-offline.zip",
    "DSH-Portable-windows-x64-complete-offline.zip",
    "DSH-Portable-macos-arm64.zip",
    "DSH-Portable-macos-x64.zip",
    "DeepSeek-Herness-linux-x64.AppImage",
    "DeepSeek-Herness-linux-arm64.AppImage",
    "DSH-Portable-linux-x64.tar.gz",
    "DSH-Portable-linux-arm64.tar.gz",
    "checksums.txt"
  ];

  for (const asset of assets) assert.match(`${html}\n${app}`, new RegExp(asset.replaceAll(".", "\\.")));
  assert.doesNotMatch(`${html}\n${app}`, /windows-x64-offline\.exe/);
});

test("website download packages match both README language editions", () => {
  const readmeAssets = source => new Set(
    [...source.matchAll(/releases\/latest\/download\/((?:DSH-Portable|DeepSeek-Herness)-[A-Za-z0-9.-]+\.(?:exe|zip|AppImage|tar\.gz))/g)]
      .map(([, asset]) => asset),
  );
  const siteAssets = new Set(
    [...`${html}\n${app}`.matchAll(/\b((?:DSH-Portable|DeepSeek-Herness)-[A-Za-z0-9.-]+\.(?:exe|zip|AppImage|tar\.gz))\b/g)]
      .map(([, asset]) => asset),
  );
  const chineseAssets = readmeAssets(readme);
  const englishAssets = readmeAssets(readmeEnglish);
  assert.deepEqual([...englishAssets].sort(), [...chineseAssets].sort());
  assert.deepEqual([...siteAssets].sort(), [...chineseAssets].sort());
});

test("website localization keys are present in both languages and state the new position", () => {
  const htmlKeys = new Set([...html.matchAll(/data-i18n="([^"]+)"/g)].map(([, key]) => key));
  const dictionaryStart = app.indexOf("  en: {");
  const dictionaryEnd = app.indexOf("\n  },", dictionaryStart);
  assert.notEqual(dictionaryStart, -1);
  assert.notEqual(dictionaryEnd, -1);
  const englishKeys = new Set(
    [...app.slice(dictionaryStart, dictionaryEnd).matchAll(/^\s{4}([A-Za-z][A-Za-z0-9]*):/gm)]
      .map(([, key]) => key),
  );
  assert.deepEqual([...englishKeys].sort(), [...htmlKeys].sort());
  assert.match(html, /一个文件夹，带走会话、设置、插件和工作区/);
  assert.doesNotMatch(html, /无需 Node\.js 的可移动|自带运行环境和插件市场|免配环境|界面装插件/);
  assert.doesNotMatch(app, /No runtime setup|Visual plugins|No Node\.js required/i);
  assert.match(html, /不是 DeepSeek 官方应用，也未获 DeepSeek 背书/);
  assert.match(app, /not an official DeepSeek app, and is not endorsed by DeepSeek/i);
  assert.match(html, /href="https:\/\/www\.deepseek\.com\/harness\/"/);
  assert.match(html, /稳定版 0\.x（Native）/);
  assert.match(html, /1\.0 开发线[\s\S]*仅 Windows[\s\S]*不在公开下载中/);
  assert.match(app, /Stable 0\.x supports Windows, macOS, and Linux/);
  assert.match(app, /1\.0 development line[\s\S]*Windows only[\s\S]*outside public downloads/);
});

test("website exposes accessible platform selection and bilingual content", () => {
  assert.match(html, /role="tablist"/);
  assert.match(html, /role="tabpanel"/);
  assert.match(html, /data-language-switch/);
  assert.match(html, /data-i18n="heroTitle"/);
  assert.match(app, /setLanguage\(initialLanguage\)/);
});

test("website defaults to Chinese and builds an indexable English route", async () => {
  assert.match(html, /<meta name="dsh-page-language" content="zh">/);
  assert.match(html, /hreflang="zh-CN" href="https:\/\/wsl043\.github\.io\/DSH-Portable\/"/);
  assert.match(html, /hreflang="en" href="https:\/\/wsl043\.github\.io\/DSH-Portable\/en\/"/);
  assert.match(html, /hreflang="x-default" href="https:\/\/wsl043\.github\.io\/DSH-Portable\/"/);
  assert.match(app, /meta\[name=['"]dsh-page-language['"]\]/);
  assert.doesNotMatch(app, /navigator\.language/);

  await execFileAsync(process.execPath, ["scripts/build-site.mjs"], {
    cwd: repositoryRoot,
    windowsHide: true
  });
  const english = await readFile(new URL("../build/site/en/index.html", import.meta.url), "utf8");
  assert.match(english, /<html lang="en">/);
  assert.match(english, /<meta name="dsh-page-language" content="en">/);
  assert.match(english, /<link rel="canonical" href="https:\/\/wsl043\.github\.io\/DSH-Portable\/en\/">/);
  assert.match(english, /<title>DSH-Portable \| Portable DeepSeek Harness in a folder[^<]*<\/title>/);
  assert.match(english, /<meta name="description" content="DSH-Portable is the portable edition of DeepSeek Harness: take sessions, settings, plugins, and your workspace in one folder\./);
  assert.match(english, /<meta property="og:title" content="DSH-Portable \| Portable DeepSeek Harness">/);
  assert.match(english, /<meta property="og:description" content="One folder for sessions, settings, plugins, and your workspace\./);
  assert.match(english, /<meta name="twitter:title" content="DSH-Portable \| Portable DeepSeek Harness">/);
  assert.match(english, /<meta name="twitter:description" content="One folder for sessions, settings, plugins, and your workspace\./);
  assert.match(english, /"description": "The portable edition of DeepSeek Harness: take sessions, settings, plugins, and your workspace in one folder\./);
  assert.match(english, /"operatingSystem":\s*"Windows, macOS, Linux \(stable 0\.x\); Windows \(1\.0 development line\)"/);
  assert.match(english, /"softwareRequirements": "Stable 0\.x: Windows, macOS, and Linux; 1\.0 development line: Windows-only development builds and drafts, outside public downloads\."/);
  assert.doesNotMatch(english, /"softwareRequirements"[^\n]*Node\.js|bundled runtime and visual plugin market|visual plugin installation/i);
  assert.match(english, /DeepSeek Harness<br>in a portable folder\./);
  assert.match(english, /not an official DeepSeek app, and is not endorsed by DeepSeek/i);
  assert.match(english, /href="https:\/\/www\.deepseek\.com\/harness\/"/);
  assert.match(english, /Stable 0\.x supports Windows, macOS, and Linux/);
  assert.match(english, /1\.0 development line[\s\S]*Windows only[\s\S]*outside public downloads/);
  const englishAssets = new Set(
    [...`${english}\n${await readFile(new URL("../build/site/app.js", import.meta.url), "utf8")}`.matchAll(/\b((?:DSH-Portable|DeepSeek-Herness)-[A-Za-z0-9.-]+\.(?:exe|zip|AppImage|tar\.gz))\b/g)]
      .map(([, asset]) => asset),
  );
  const readmeEnglishAssets = new Set(
    [...readmeEnglish.matchAll(/releases\/latest\/download\/((?:DSH-Portable|DeepSeek-Herness)-[A-Za-z0-9.-]+\.(?:exe|zip|AppImage|tar\.gz))/g)]
      .map(([, asset]) => asset),
  );
  assert.deepEqual([...englishAssets].sort(), [...readmeEnglishAssets].sort());
  assert.match(english, /class="language-switch" href="\.\.\/" hreflang="zh-CN"/);
  assert.match(english, /href="\.\.\/styles\.css\?v=[a-f0-9]+"/);
  assert.match(english, /src="\.\.\/assets\/dsh-interface-en\.png"/);
});

test("website ships its cinematic product stage with motion safeguards", () => {
  assert.match(css, /assets\/hero-atmosphere\.png/);
  assert.match(html, /data-product-stage/);
  assert.match(app, /import\(["']\.\/scene\.js["']\)/);
  assert.match(app, /prefers-reduced-motion: reduce/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /hero-atmosphere/);
});

test("website lets visitors override motion without discarding the system preference", () => {
  assert.match(html, /data-motion-control/);
  assert.match(app, /dsh-portable-motion/);
  assert.match(app, /systemMotionPreference\.addEventListener\("change"/);
  assert.match(app, /dataset\.motion = resolvedMotion/);
  assert.match(css, /html\[data-motion="full"\]/);
  assert.match(css, /html\[data-motion="reduced"\]/);
});

test("website replaces the workflow simulation with the approved water scene", async () => {
  const scene = await readFile(new URL("../site/scene.js", import.meta.url), "utf8");
  assert.doesNotMatch(html, /data-demo-|id="tryout"/);
  assert.match(html, /id="volume-scene"/);
  assert.match(scene, /renderer.render\(scene,\s*camera\)/);
  assert.match(scene, /image:\s*\{\s*value:\s*sceneTarget.texture,?\s*\}/);
  assert.match(scene, /pointerleave/);
  assert.match(scene, /webglcontextlost/);
});

test("common desktop widths keep the product proof in the hero composition", () => {
  assert.doesNotMatch(css, /@media \(max-width: 1280px\)[\s\S]{0,500}grid-template-columns:\s*1fr/);
  assert.match(css, /@media \(max-width: 1080px\)/);
});

test("website publishes only through the currently verified Pages domain", async () => {
  await assert.rejects(access(cname), error => error?.code === "ENOENT");
  assert.match(html, /<link rel="canonical" href="https:\/\/wsl043\.github\.io\/DSH-Portable\/">/);
  assert.match(html, /<meta property="og:url" content="https:\/\/wsl043\.github\.io\/DSH-Portable\/">/);
});

test("website exposes search-engine metadata without duplicating release files", () => {
  assert.match(html, /<title>DSH-Portable｜DeepSeek Harness 的便携版<\/title>/);
  assert.match(html, /<meta name="description" content="DSH-Portable 是 DeepSeek Harness 的便携版：一个文件夹带走会话、设置、插件和工作区/);
  assert.match(html, /<meta property="og:title" content="DSH-Portable｜DeepSeek Harness 便携版">/);
  assert.match(html, /<meta property="og:description" content="一个文件夹带走会话、设置、插件和工作区/);
  assert.match(html, /<meta name="twitter:title" content="DSH-Portable｜DeepSeek Harness 便携版">/);
  assert.match(html, /<meta name="twitter:description" content="一个文件夹带走会话、设置、插件和工作区/);
  assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);
  assert.match(html, /<script type="application\/ld\+json">[\s\S]*"@type":\s*"SoftwareApplication"/);
  assert.match(html, /"operatingSystem":\s*"Windows, macOS, Linux \(stable 0\.x\); Windows \(1\.0 development line\)"/);
  assert.match(html, /"softwareRequirements":\s*"稳定版 0\.x：Windows、macOS 和 Linux；1\.0 开发线：仅 Windows 开发构建与草稿，不在公开下载中。"/);
  assert.doesNotMatch(html, /"softwareRequirements"[^\n]*Node\.js/);
  assert.match(html, /"downloadUrl":\s*"https:\/\/github\.com\/WSL043\/DSH-Portable\/releases\/latest\/download\/DSH-Portable-windows-x64\.exe"/);
  assert.match(robots, /User-agent:\s*\*[\s\S]*Allow:\s*\/[\s\S]*Sitemap:\s*https:\/\/wsl043\.github\.io\/DSH-Portable\/sitemap\.xml/);
  assert.match(sitemap, /<loc>https:\/\/wsl043\.github\.io\/DSH-Portable\/<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/wsl043\.github\.io\/DSH-Portable\/en\/<\/loc>/);
  assert.match(sitemap, /xhtml:link rel="alternate" hreflang="zh-CN"/);
  assert.match(sitemap, /xhtml:link rel="alternate" hreflang="en"/);
  assert.doesNotMatch(`${robots}\n${sitemap}`, /releases\/latest\/download/);
});

test("hero and trust copy use durable portable-product facts", () => {
  assert.match(html, /DeepSeek Harness<br>的便携版/);
  assert.match(app, /Do I need to install Node\.js separately/);
  assert.doesNotMatch(html, /≈\s*55\s*KB|−15%/);
  assert.match(`${html}\n${app}`, /SmartScreen/);
  assert.match(`${html}\n${app}`, /data\/.*workspace\/|data and workspace/);
  assert.doesNotMatch(`${html}\n${app}`, /google-analytics|googletagmanager|plausible|segment\.com/i);
});

test("Pages workflow deploys only the staged website", () => {
  assert.match(workflow, /node scripts\/build-site\.mjs/);
  assert.match(workflow, /path: build\/site/);
  assert.doesNotMatch(workflow, /path:\s*\.\s*$/m);
  const build = workflow.split('\n  build:')[1].split('\n  deploy:')[0];
  const defaults = workflow.split('\njobs:')[0];
  assert.doesNotMatch(defaults + build, /(?:pages|id-token): write/);
  assert.match(workflow.split('\n  deploy:')[1], /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow.split('\n  deploy:')[1], /permissions:\s+pages: write\s+id-token: write/);
});

test("website publishes truthful privacy and code-signing boundaries", () => {
  assert.match(html, /https:\/\/github\.com\/WSL043\/DSH-Portable\/blob\/main\/PRIVACY\.md/);
  assert.match(html, /https:\/\/github\.com\/WSL043\/DSH-Portable\/blob\/main\/CODE_SIGNING\.md/);
  assert.match(app, /Privacy/);
  assert.match(app, /Code signing/);
  assert.match(privacy, /does not operate a telemetry or analytics service/i);
  assert.match(signing, /application is in progress/i);
  assert.match(signing, /current release files are unsigned/i);
  assert.match(signing, /Free code signing provided by SignPath\.io, certificate by SignPath Foundation/);
});


test("Star links point at the repository, and usage guides are crawlable HTML", async () => {
  assert.match(html, /data-i18n="starAction"/);
  assert.doesNotMatch(html, /DSH-Portable\/stargazers/);
  assert.match(sitemap, /guides\/get-started\.html/);
  const guide = await readFile(new URL("../build/site/guides/get-started.html", import.meta.url), "utf8");
  assert.match(guide, /<h1>[^<]+<\/h1>/);
  assert.match(guide, /<link rel="canonical" href="https:\/\/wsl043\.github\.io\/DSH-Portable\/guides\/get-started\.html">/);
  assert.doesNotMatch(guide, /<canvas/);
});
