// Bundles the Node game server (src/server) into dist/server/index.js.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/server/index.ts'],
  outfile: 'dist/server/index.js',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: false,
  // `vite` is only used by `npm run dev` (dynamically imported), never in production.
  external: ['ws', 'vite'],
  banner: {
    js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);",
  },
  logLevel: 'info',
});
