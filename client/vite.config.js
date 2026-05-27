import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

const config = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../config.json'), 'utf8')
);

const serverPort = config.port || 3001;
const clientPort = config.clientPort || 5173;

export default defineConfig({
  plugins: [react()],
  server: {
    port: clientPort,
    strictPort: true,
    proxy: {
      '/api': `http://localhost:${serverPort}`,
    },
  },
});
