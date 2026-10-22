#!/usr/bin/env node
/* 把 src/native-chrome.js + src/entry.js 内联成 DSH 的 client bundle（lib/client.js）。
 * 不引入打包器：两份源码都是独立作用域的 IIFE，顺序拼接后整段塞进
 * window.__ModuleLoader__.load 的 factory 里即可。 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFile(join(root, file), "utf8");

const [nativeChrome, entry] = await Promise.all([read("src/native-chrome.js"), read("src/entry.js")]);

const indent = (text) =>
  text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => (line.length > 0 ? "\t\t" + line : line))
    .join("\n");

const bundle = `window.__ModuleLoader__.load({
\tid: "dsh-frameless-page",
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

${indent(nativeChrome)}

${indent(entry)}

\t\treturn module.exports;
\t}
});
`;

await mkdir(join(root, "lib"), { recursive: true });
await writeFile(join(root, "lib", "client.js"), bundle, "utf8");
console.log(`built lib/client.js (${Buffer.byteLength(bundle)} bytes)`);
