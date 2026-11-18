import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Le client appelle /api et /webhooks : Vite les redirige vers le serveur Express.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:4000',
      '/auth': 'http://127.0.0.1:4000',
      '/webhooks': 'http://127.0.0.1:4000',
    },
  },
});
