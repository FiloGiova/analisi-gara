import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'client',
  plugins: [react()],
  build: {
    outDir: '../dist/client',
    emptyOutDir: true
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '^/$': 'http://localhost:3000',
      '^/privacy/?$': 'http://localhost:3000',
      '^/termini/?$': 'http://localhost:3000',
      '/public-font-': 'http://localhost:3000',
      '/api': 'http://localhost:3000',
      '/auth/callback': 'http://localhost:3000'
    },
    fs: {
      allow: ['..']
    }
  }
});
