import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: process.env.DSH_MARKET_TARGET === 'official' ? { index: 'src/official/index.ts' } : { index: 'src/index.ts', 'import-preflight': 'src/import-preflight.ts' },
  outDir: process.env.DSH_MARKET_OUTPUT ? `${process.env.DSH_MARKET_OUTPUT}/lib` : 'lib',
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
    ...(process.env.DSH_MARKET_TARGET === 'official' ? { alwaysBundle: [/^(?!@deepseek-ai\/)/] } : {}),
  },
  outputOptions: {
    entryFileNames: '[name].js',
  },
})
