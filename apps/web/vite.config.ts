import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  envDir: '../..', // один .env в корне; в браузер попадают только переменные VITE_*
  server: {
    port: 5173,
    // В разработке фронт ходит на /api, а Vite пересылает запросы локальному API без префикса.
    proxy: { '/api': { target: 'http://localhost:3000', rewrite: (path) => path.replace(/^\/api/, '') } },
  },
});
