import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, type Plugin} from 'vite';

// One id per build. The running app compares it with /build.json to know a newer version was deployed.
const BUILD_ID = (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 12) || String(Date.now());
const buildInfo = (): Plugin => ({
  name: 'build-info',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'build.json', source: JSON.stringify({ id: BUILD_ID }) });
  },
});

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), buildInfo()],
    define: { __APP_BUILD__: JSON.stringify(BUILD_ID) },
    build: { sourcemap: false }, // never publish readable source maps
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
