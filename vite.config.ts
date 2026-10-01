import { defineConfig, loadEnv, type Plugin } from 'vite';
import { DEFAULT_ADMIN_CODE, adminCodeHash } from './src/shared/sha256';

/**
 * Admin console (offline): only a salted SHA-256 of VITE_ADMIN_CODE is baked into
 * the bundle (`__HF_ADMIN_HASH__`). The plaintext is also removed from Vite's env
 * object so `import.meta.env` can never inline it. Default code: see README.
 */
function adminCode(): Plugin {
  return {
    name: 'hf-admin-code',
    configResolved(config) {
      delete (config.env as Record<string, unknown>).VITE_ADMIN_CODE;
    },
  };
}

// The client is a static bundle that works from any path (GitHub Pages, a CDN,
// or the bundled Node server). The Node server (src/server) serves dist/client
// and the WebSocket endpoint on the same origin.
export default defineConfig(({ mode }) => ({
  root: '.',
  define: {
    __HF_ADMIN_HASH__: JSON.stringify(adminCodeHash(loadEnv(mode, '.', 'VITE_ADMIN_').VITE_ADMIN_CODE || DEFAULT_ADMIN_CODE)),
  },
  plugins: [adminCode()],
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
    plugins: () => [adminCode()],
  },
  server: {
    host: true,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
}) as any);
