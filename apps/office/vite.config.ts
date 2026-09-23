import { defineConfig } from 'vite';

export default defineConfig({
  optimizeDeps: { exclude: ['recast-navigation', '@recast-navigation/wasm'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
