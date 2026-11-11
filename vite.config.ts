import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
  },
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('@mysten') || id.includes('@noble') || id.includes('bcs')) {
              return 'vendor-sui';
            }
            if (id.includes('@cetusprotocol') || id.includes('@7kprotocol')) {
              return 'vendor-dex';
            }
            if (id.includes('navi-sdk')) {
              return 'vendor-navi';
            }
            if (id.includes('lucide-react')) {
              return 'vendor-icons';
            }
            if (id.includes('react') || id.includes('react-dom') || id.includes('@tanstack')) {
              return 'vendor-react';
            }
          }
        },
      },
    },
  },
});

