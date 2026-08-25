import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: { index: 'src/index.ts' },
  outDir: 'lib',
  format: 'esm',
  platform: 'node',
  target: 'node24',
  dts: false,
  sourcemap: false,
  clean: true,
  minify: true,
  fixedExtension: false,
  deps: {
    neverBundle: [/^@deepseek-ai\//],
  },
  outputOptions: {
    entryFileNames: 'index.js',
  },
})
