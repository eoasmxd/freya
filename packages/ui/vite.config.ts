import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs/promises';
import path from 'node:path';

function rootIconPlugin(): Plugin {
  const rootIconPath = path.resolve(__dirname, '../../icon.png');
  return {
    name: 'freya-root-icon',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url === '/icon.png') {
          try {
            const data = await fs.readFile(rootIconPath);
            res.setHeader('Content-Type', 'image/png');
            res.end(data);
            return;
          } catch {
            next();
          }
        }
        next();
      });
    },
    async generateBundle() {
      try {
        const data = await fs.readFile(rootIconPath);
        this.emitFile({
          type: 'asset',
          fileName: 'icon.png',
          source: data,
        });
      } catch (err: any) {
        console.warn('[Vite] Failed to copy root icon.png:', err.message);
      }
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), rootIconPlugin()],
  server: {
    port: 5173,
    host: true
  }
});
