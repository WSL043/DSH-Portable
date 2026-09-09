import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "build/site");
const evidence = path.join(root, "build/site-acceptance");
await mkdir(evidence, { recursive: true });
const mime = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};
const server = createServer(async (req, res) => {
  try {
    let file = path.resolve(
      output,
      "." + decodeURIComponent(new URL(req.url, "http://localhost").pathname),
    );
    if (!file.startsWith(output + path.sep) && file !== output)
      throw new Error("Invalid path");
    if ((await stat(file)).isDirectory()) file = path.join(file, "index.html");
    res.setHeader(
      "Content-Type",
      mime[path.extname(file)] || "application/octet-stream",
    );
    res.end(await readFile(file));
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const errors = [];
const results = [];
async function pageFor(options = {}) {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    colorScheme: "dark",
    ...options,
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.addInitScript(() => {
    window.sceneDraws = 0;
    for (const name of ['drawArrays','drawElements']) {
      const draw = WebGL2RenderingContext.prototype[name];
      WebGL2RenderingContext.prototype[name] = function(...args) {
        window.sceneDraws++;
        return draw.apply(this, args);
      };
    }
  });
  return page;
}
try {
  const page = await pageFor({ reducedMotion: "reduce" });
  await page.goto(base);
  await page.waitForSelector(".scene-ready");
  assert.equal(
    await page.locator("html").getAttribute("data-motion"),
    "reduced",
  );
  const canvas = page.locator("#volume-scene");
  const still = await canvas.screenshot();
  await page.waitForTimeout(250);
  assert.ok(
    still.equals(await canvas.screenshot()),
    "Reduced-motion scene must remain still",
  );
  await page.locator("[data-motion-control]").click();
  await page.waitForTimeout(250);
  const moving = await canvas.screenshot();
  await page.waitForTimeout(700);
  assert.ok(
    !moving.equals(await canvas.screenshot()),
    "Enabled fog and water must move",
  );
  await page.mouse.move(1240, 250);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(evidence, "desktop-hover.png") });
  await page.mouse.move(600, 640);
  await page.waitForTimeout(500);
  await page.screenshot({
    path: path.join(evidence, "desktop-hover-opposite.png"),
  });
  await page.mouse.move(10, 100);
  await page.locator(".theme-toggle").click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(evidence, "theme-midpoint.png") });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(evidence, "desktop-light.png") });
  await page.locator(".theme-toggle").click();
  await page.waitForTimeout(250);
  await page.locator(".theme-toggle").click();
  await page.waitForTimeout(2400);
  assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
  await page.reload();
  await page.waitForSelector(".scene-ready");
  assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
  assert.equal(await page.locator("html").getAttribute("data-motion"), "full");
  results.push(
    "Reduced-motion default, explicit opt-in, moving scene, rapid theme reversal, persisted appearance",
  );
  await page.locator('footer').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const offscreenDraws = await page.evaluate(() => window.sceneDraws);
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.sceneDraws), offscreenDraws, 'Offscreen scene must stop rendering');
  await page.locator('.theme-toggle').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  assert.ok(await page.evaluate(() => window.sceneDraws) > offscreenDraws, 'Visible scene must resume');
  results.push('Offscreen rendering stops and resumes on return');
  // Verify actual choices and their release filenames, including keyboard navigation.
  await page.locator("#tab-windows").click();
  await page.locator("#tab-windows").press("ArrowRight");
  assert.equal(
    await page.locator("#tab-macos").getAttribute("aria-selected"),
    "true",
  );
  await page.locator('#panel-macos [data-arch="x64"]').click();
  assert.match(
    await page.locator("[data-mac-download]").getAttribute("href"),
    /macos-x64.zip$/,
  );
  await page.locator("#tab-linux").click();
  await page.locator('#panel-linux [data-arch="arm64"]').click();
  assert.match(
    await page.locator('[data-linux-download="appimage"]').getAttribute("href"),
    /linux-arm64.AppImage$/,
  );
  await page.locator("[data-screenshot]").first().click();
  assert.equal(await page.locator("dialog").evaluate((e) => e.open), true);
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("dialog").evaluate((e) => e.open), false);
  await page.locator(".theme-toggle").scrollIntoViewIfNeeded();
  await page.locator(".theme-toggle").click();
  await page.waitForTimeout(2400);
  await page.screenshot({
    path: path.join(evidence, "desktop-dark-full.png"),
    fullPage: true,
  });
  results.push(
    "Keyboard platform selection, architecture downloads, screenshot dialog and Escape",
  );
  await page.close();
  const en = await pageFor();
  await en.goto(base + "/en/");
  await en.waitForSelector(".scene-ready");
  assert.equal(await en.locator("html").getAttribute("lang"), "en");
  assert.match(await en.locator("h1").innerText(), /Your workspace/);
  assert.equal(
    await en.locator("[data-language-switch]").getAttribute("href"),
    "../",
  );
  await en.screenshot({ path: path.join(evidence, "english.png") });
  await en.close();
  for (const width of [360, 390, 768, 1024]) {
    const mobile = await pageFor({
      viewport: { width, height: 844 },
      reducedMotion: "reduce",
    });
    await mobile.goto(base);
    await mobile.waitForSelector(".scene-ready");
    assert.equal(
      await mobile.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      `Overflow at ${width}px`,
    );
    await mobile.screenshot({
      path: path.join(evidence, `viewport-${width}.png`),
      fullPage: true,
    });
    await mobile.close();
  }
  results.push("English route and 360/390/768/1024px layouts");
  const fallback = await browser.newPage({
    viewport: { width: 390, height: 844 },
    colorScheme: "light",
  });
  await fallback.route("**/scene.js*", (route) => route.abort());
  await fallback.goto(base);
  await fallback.waitForSelector(".scene-unavailable");
  assert.equal(await fallback.locator(".fallback-window").isVisible(), true);
  await fallback.locator("#tab-macos").click();
  assert.equal(await fallback.locator("#panel-macos").isVisible(), true);
  await fallback.screenshot({
    path: path.join(evidence, "static-fallback.png"),
  });
  results.push(
    "Scene failure retains screenshot, content, and working downloads",
  );
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(evidence, "results.json"),
    JSON.stringify({ passed: true, results, errors }, null, 2),
  );
  console.log(results.join("\n"));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
