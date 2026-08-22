import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../site/index.html", import.meta.url), "utf8");
const app = await readFile(new URL("../site/app.js", import.meta.url), "utf8");
const css = await readFile(new URL("../site/styles.css", import.meta.url), "utf8");
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

test("Pages workflow deploys only the staged website", () => {
  assert.match(workflow, /node scripts\/build-site\.mjs/);
  assert.match(workflow, /path: build\/site/);
  assert.doesNotMatch(workflow, /path:\s*\.\s*$/m);
});
