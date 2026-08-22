import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, "build", "site");

await rm(output, { recursive: true, force: true });
await mkdir(path.join(output, "assets"), { recursive: true });
await cp(path.join(root, "site"), output, { recursive: true });

for (const asset of ["DSH-Portable.svg", "DSH-Portable-white.svg", "DSH-Portable-512.png", "dsh-interface-zh.png", "dsh-interface-en.png", "hero-atmosphere.png"]) {
  await cp(path.join(root, "assets", asset), path.join(output, "assets", asset));
}

console.log(`Website staged at ${output}`);
