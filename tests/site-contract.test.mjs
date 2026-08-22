import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../site/index.html", import.meta.url), "utf8");
const app = await readFile(new URL("../site/app.js", import.meta.url), "utf8");
const css = await readFile(new URL("../site/styles.css", import.meta.url), "utf8");
const cname = await readFile(new URL("../site/CNAME", import.meta.url), "utf8");
const robots = await readFile(new URL("../site/robots.txt", import.meta.url), "utf8");
const sitemap = await readFile(new URL("../site/sitemap.xml", import.meta.url), "utf8");
const workflow = await readFile(new URL("../.github/workflows/pages.yml", import.meta.url), "utf8");

test("website uses only stable release asset names that the product publishes", () => {
  const assets = [
    "DSH-Portable-windows-x64.exe",
    "DSH-Portable-windows-x64-offline.zip",
    "DeepSeek-Herness-Setup.exe",
    "DeepSeek-Herness-macos-arm64.dmg",
    "DeepSeek-Herness-macos-x64.dmg",
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

test("website publishes its canonical custom domain", () => {
  assert.equal(cname.trim(), "dsh-portable.js.org");
  assert.match(html, /<link rel="canonical" href="https:\/\/dsh-portable\.js\.org\/">/);
  assert.match(html, /<meta property="og:url" content="https:\/\/dsh-portable\.js\.org\/">/);
});

test("website exposes search-engine metadata without duplicating release files", () => {
  assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);
  assert.match(html, /<script type="application\/ld\+json">[\s\S]*"@type":\s*"SoftwareApplication"/);
  assert.match(html, /"downloadUrl":\s*"https:\/\/github\.com\/WSL043\/DSH-Portable\/releases\/latest"/);
  assert.match(robots, /User-agent:\s*\*[\s\S]*Allow:\s*\/[\s\S]*Sitemap:\s*https:\/\/dsh-portable\.js\.org\/sitemap\.xml/);
  assert.match(sitemap, /<loc>https:\/\/dsh-portable\.js\.org\/<\/loc>/);
  assert.doesNotMatch(`${robots}\n${sitemap}`, /releases\/latest\/download/);
});

test("Pages workflow deploys only the staged website", () => {
  assert.match(workflow, /node scripts\/build-site\.mjs/);
  assert.match(workflow, /path: build\/site/);
  assert.doesNotMatch(workflow, /path:\s*\.\s*$/m);
});
