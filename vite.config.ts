import { defineConfig } from 'vite';

// The client is a static bundle that works from any path (GitHub Pages, a CDN,
// or the bundled Node server). The Node server (src/server) serves dist/client
// and the WebSocket endpoint on the same origin.
export default defineConfig({
  root: '.',
  base: './',
  publicDir: 'public',
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
        },
      },
    },
  },
  worker: {
    format: 'es',
  },
  server: {
    host: true,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
} as any);
