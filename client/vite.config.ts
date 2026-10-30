import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Le client appelle /api et /webhooks : Vite les redirige vers le serveur Express.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:4000',
      '/webhooks': 'http://localhost:4000',
    },
  },
});
