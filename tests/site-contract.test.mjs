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

test("website uses only stable release asset names that the product publishes", () => {
  const assets = [
    "DSH-Portable-windows-x64.exe",
    "DSH-Portable-windows-x64-offline.zip",
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
  assert.match(english, /<title>DSH-Portable[^<]*Portable DeepSeek Harness/);
  assert.match(english, /class="language-switch" href="\.\.\/" hreflang="zh-CN"/);
  assert.match(english, /href="\.\.\/styles\.css"/);
  assert.match(english, /src="\.\.\/assets\/dsh-interface-en\.png"/);
});

test("website ships its cinematic product stage with motion safeguards", () => {
  assert.match(html, /assets\/hero-atmosphere\.png/);
  assert.match(html, /data-product-stage/);
  assert.match(app, /IntersectionObserver/);
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

test("website motion tells the portable story instead of adding decorative noise", () => {
  assert.match(html, /data-journey-step/);
  assert.match(html, /class="portable-facts"/);
  assert.match(html, /data-i18n="factLauncher"/);
  assert.match(app, /factTargetsValue/);
  assert.match(css, /\.portable-facts/);
  assert.match(app, /data-journey-step/);
  assert.match(app, /--journey-progress/);
  assert.match(css, /@keyframes atmosphere-drift/);
  assert.match(css, /@keyframes stage-float/);
  assert.match(css, /--journey-progress/);
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
  assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);
  assert.match(html, /<script type="application\/ld\+json">[\s\S]*"@type":\s*"SoftwareApplication"/);
  assert.match(html, /"downloadUrl":\s*"https:\/\/github\.com\/WSL043\/DSH-Portable\/releases\/latest\/download\/DSH-Portable-windows-x64\.exe"/);
  assert.match(robots, /User-agent:\s*\*[\s\S]*Allow:\s*\/[\s\S]*Sitemap:\s*https:\/\/wsl043\.github\.io\/DSH-Portable\/sitemap\.xml/);
  assert.match(sitemap, /<loc>https:\/\/wsl043\.github\.io\/DSH-Portable\/<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/wsl043\.github\.io\/DSH-Portable\/en\/<\/loc>/);
  assert.match(sitemap, /xhtml:link rel="alternate" hreflang="zh-CN"/);
  assert.match(sitemap, /xhtml:link rel="alternate" hreflang="en"/);
  assert.doesNotMatch(`${robots}\n${sitemap}`, /releases\/latest\/download/);
});

test("hero and trust copy use durable portable-product facts", () => {
  assert.match(html, /无需 Node\.js/);
  assert.match(app, /No Node\.js required/);
  assert.doesNotMatch(html, /≈\s*55\s*KB|−15%/);
  assert.match(`${html}\n${app}`, /SmartScreen/);
  assert.match(`${html}\n${app}`, /data\/.*workspace\/|data and workspace/);
  assert.doesNotMatch(`${html}\n${app}`, /google-analytics|googletagmanager|plausible|segment\.com/i);
});

test("Pages workflow deploys only the staged website", () => {
  assert.match(workflow, /node scripts\/build-site\.mjs/);
  assert.match(workflow, /path: build\/site/);
  assert.doesNotMatch(workflow, /path:\s*\.\s*$/m);
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
