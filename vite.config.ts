import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';
import { visualizer } from 'rollup-plugin-visualizer';

/**
 * Forces a full page reload when a hook file is saved, instead of hot-swapping it.
 * Without this, Vite's HMR remounts components that use the hook, which re-fires
 * their useEffect calls. Those effects call bridge API functions that read from the
 * Redux store — but the store hasn't finished reloading its data from localStorage
 * yet, so the values are null and the app throws an error.
 */
const fullReloadOnHooksChange = {
  name: 'full-reload-on-hooks-change',
  handleHotUpdate({ file, server }: { file: string; server: any }) {
    if (file.includes('/src/js/hooks/')) {
      server.ws.send({ type: 'full-reload' });
      return [];
    }
  },
};

export default defineConfig({
  // Relative asset URLs so the build works under Tesla / subdirectory hosts
  // and matches the CRA layout the server already expects (static/js|css|media).
  base: './',
  appType: 'spa',
  plugins: [
    react(),
    svgr(),
    fullReloadOnHooksChange,
    process.env.ANALYZE && visualizer({ open: true, filename: 'build/stats.html', gzipSize: true, brotliSize: true }),
  ],
  resolve: {
    tsconfigPaths: true,
  },
  server: {
    host: true,
    port: 4000,
    open: true,
  },
  build: {
    outDir: 'build',
    // Keep empty so entry/chunk/asset file names control the full path under build/
    assetsDir: 'static',
    sourcemap: false,
    target: 'es2020',
    rolldownOptions: {
      output: {
        // CRA-compatible folder layout for Tesla static hosting:
        //   static/js/*.js  static/css/*.css  static/media/*
        entryFileNames: 'static/js/[name].[hash].js',
        chunkFileNames: 'static/js/[name].[hash].js',
        assetFileNames: (assetInfo) => {
          const fileName = assetInfo.names?.[0] || assetInfo.name || '';
          if (fileName.endsWith('.css')) {
            return 'static/css/[name].[hash][extname]';
          }
          return 'static/media/[name].[hash][extname]';
        },
        manualChunks: (id) => {
          if (id.includes('node_modules/@radix-ui/')) {
            return 'radix';
          }
          if (id.includes('node_modules/dashjs/')) {
            return 'dashjs';
          }
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/_archived/**'],
    env: {
      VITE_ENV: 'local',
    },
  },
});
