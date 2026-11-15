import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: 'web',
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': { target: 'http://localhost:8787', changeOrigin: true },
      '/img': { target: 'http://localhost:8787', changeOrigin: true },
    },
  },
  build: { outDir: '../dist/web', emptyOutDir: true },
});
