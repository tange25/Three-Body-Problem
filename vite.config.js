import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    port: 5173,
    open: true,
  },
  build: {
    target: 'es2019',
    outDir: 'dist',
    assetsDir: 'assets',
    // 单文件版需要把 bundle 整体内联进 HTML，因此产物必须是自包含 IIFE
    rollupOptions: {
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'assets/three-body.js',
        assetFileNames: 'assets/three-body.[ext]',
      },
    },
    chunkSizeWarningLimit: 2000,
  },
});
