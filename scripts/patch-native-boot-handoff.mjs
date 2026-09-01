import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MARKER = 'dsh-portable-native-boot-handoff-v3'
const CSS_MARKER = 'dsh-portable-native-boot-logo-v1'

function replaceRequired(source, needle, replacement, label) {
  const matches = source.split(needle).length - 1
  if (matches !== 1) throw new Error(`${label}: expected 1 match, found ${matches}`)
  return source.replace(needle, replacement)
}

export function patchNativeBootHandoff(source) {
  if (source.includes(MARKER)) return source

  const original = `\t\tfunction BootHandoff(props) {
\t\t\tconst [ready, setReady] = (0, react.useState)(false);
\t\t\t(0, react.useLayoutEffect)(() => {
\t\t\t\tsetReady(true);
\t\t\t}, []);
\t\t\tif (ready) return props.app();
\t\t\treturn (0, react.createElement)("div", {
\t\t\t\tclassName: props.boot.className,
\t\t\t\t"data-dsh-boot": "",
\t\t\t\tdangerouslySetInnerHTML: { __html: props.boot.html }
\t\t\t});
\t\t}`

  const replacement = `\t\t/* ${MARKER} */
\t\tfunction BootHandoff(props) {
\t\t\tconst [ready, setReady] = (0, react.useState)(false);
\t\t\tconst [surfaceReady, setSurfaceReady] = (0, react.useState)(false);
\t\t\tconst nativeHost = globalThis.chrome?.webview;
\t\t\t(0, react.useLayoutEffect)(() => {
\t\t\t\tif (nativeHost === void 0) {
\t\t\t\t\tsetReady(true);
\t\t\t\t\tsetSurfaceReady(true);
\t\t\t\t\treturn;
\t\t\t\t}
\t\t\t\tconst root = document.querySelector("#root");
\t\t\t\tlet readyFrames = 0;
\t\t\t\tlet disposed = false;
\t\t\t\tlet completed = false;
\t\t\t\tconst started = performance.now();
\t\t\t\tconst finish = () => {
\t\t\t\t\tif (disposed || completed) return;
\t\t\t\t\tconst now = performance.now();
\t\t\t\t\tconst fontsReady = document.fonts === void 0 || document.fonts.status === "loaded";
\t\t\t\t\tconst rootRect = root?.getBoundingClientRect();
\t\t\t\t\tconst rootStyle = root === null ? null : getComputedStyle(root);
\t\t\t\t\tconst rootVisible = rootRect !== void 0 && rootRect.width >= Math.max(320, innerWidth * 0.8) && rootRect.height >= Math.max(240, innerHeight * 0.8)
\t\t\t\t\t\t&& rootStyle?.display !== "none" && rootStyle?.visibility !== "hidden" && rootStyle?.opacity !== "0";
\t\t\t\t\tconst text = String(root?.innerText || "").replace(/\\s+/g, " ").trim();
\t\t\t\t\tlet visibleControls = 0;
\t\t\t\t\tfor (const control of root?.querySelectorAll("button,input,textarea,[contenteditable=true],[role=button]") || []) {
\t\t\t\t\t\tconst rect = control.getBoundingClientRect();
\t\t\t\t\t\tconst style = getComputedStyle(control);
\t\t\t\t\t\tif (rect.width >= 20 && rect.height >= 20 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0") visibleControls += 1;
\t\t\t\t\t}
\t\t\t\t\tif (fontsReady && rootVisible && text.length > 0 && visibleControls >= 2) readyFrames += 1;
\t\t\t\t\telse readyFrames = 0;
\t\t\t\t\tif (readyFrames >= 3) {
\t\t\t\t\t\tcompleted = true;
\t\t\t\t\t\tnativeHost.postMessage({ type: "dsh-portable/surface-ready", schemaVersion: 1 });
\t\t\t\t\t\tsetSurfaceReady(true);
\t\t\t\t\t\treturn;
\t\t\t\t\t}
\t\t\t\t\tif (now - started >= 10000) return;
\t\t\t\t\trequestAnimationFrame(finish);
\t\t\t\t};
\t\t\t\tnativeHost.postMessage({ type: "dsh-portable/boot-visible", schemaVersion: 1 });
\t\t\t\tsetReady(true);
\t\t\t\trequestAnimationFrame(finish);
\t\t\t\treturn () => {
\t\t\t\t\tdisposed = true;
\t\t\t\t};
\t\t\t}, []);
\t\t\tif (nativeHost === void 0 && ready) return props.app();
\t\t\tconst boot = (0, react.createElement)("div", {
\t\t\t\tkey: "dsh-boot",
\t\t\t\tclassName: props.boot.className,
\t\t\t\t"data-dsh-boot": "",
\t\t\t\tstyle: nativeHost === void 0 ? void 0 : { position: "fixed", inset: 0, zIndex: 2147483647 },
\t\t\t\tdangerouslySetInnerHTML: { __html: props.boot.html }
\t\t\t});
\t\t\tif (nativeHost === void 0) return boot;
\t\t\treturn (0, react.createElement)(react.Fragment, null,
\t\t\t\tready ? (0, react.createElement)(react.Fragment, { key: "dsh-app" }, props.app()) : null,
\t\t\t\tsurfaceReady ? null : boot
\t\t\t);
\t\t}`

  return replaceRequired(source, original, replacement, 'native boot handoff seam changed upstream')
}

export function patchNativeBootCss(source) {
  if (source.includes(CSS_MARKER)) return source
  if (!source.includes('--dsh-boot-bg')) throw new Error('native boot CSS seam changed upstream')
  return `${source}\n/* ${CSS_MARKER} */\n[data-dsh-boot]>div:before{content:"";display:block;flex:none;width:30px;height:30px;background:center/contain no-repeat url("/favicon.svg")}`
}

async function main() {
  const appRoot = path.resolve(process.argv[2] || '')
  if (!appRoot) throw new Error('usage: node patch-native-boot-handoff.mjs <app-root>')
  const filename = path.join(appRoot, 'node_modules', '@deepseek-ai', 'dsh-client-ui-renderer', 'lib', 'client.js')
  const source = await readFile(filename, 'utf8')
  const output = patchNativeBootHandoff(source)
  await writeFile(filename, output, 'utf8')
  const assetsRoot = path.join(appRoot, 'node_modules', '@deepseek-ai', 'dsh-web-frontend', 'dist', 'assets')
  const cssFiles = (await readdir(assetsRoot)).filter(name => name.endsWith('.css'))
  let cssPatched = false
  for (const name of cssFiles) {
    const cssPath = path.join(assetsRoot, name)
    const cssSource = await readFile(cssPath, 'utf8')
    if (!cssSource.includes('--dsh-boot-bg')) continue
    await writeFile(cssPath, patchNativeBootCss(cssSource), 'utf8')
    cssPatched = true
  }
  if (!cssPatched) throw new Error('native boot CSS asset was not found')
  console.log(filename)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
