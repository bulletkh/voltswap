import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      'node:buffer': 'buffer',
      buffer: 'buffer',
    },
  },
  server: {
    port: 3000,
  },
  build: {
    chunkSizeWarningLimit: 2500,
  },
});
