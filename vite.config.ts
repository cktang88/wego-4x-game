import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const page = (p: string) => fileURLToPath(new URL(`./client/${p}`, import.meta.url));

export default defineConfig({
  root: 'client',
  build: {
    outDir: '../dist', emptyOutDir: true,
    // the game, plus the art lab (docs/ART-BIBLE.md: every recipe running) and the battle viewer demo
    rollupOptions: { input: { main: page('index.html'), lab: page('art-lab.html'), battle: page('battle-demo.html') } },
  },
  server: {
    fs: { allow: ['..'] },
    proxy: {
      '/api': 'http://localhost:8787',
      '/ws': { target: 'ws://localhost:8787', ws: true },
    },
  },
});
