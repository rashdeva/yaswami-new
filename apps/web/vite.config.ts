import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  envDir: '../..', // один .env в корне; в браузер попадают только переменные VITE_*
  server: {
    port: 5173,
    // В разработке фронт ходит на /api так же, как в продакшене; Vite пересылает запросы локальному API.
    proxy: { '/api': 'http://localhost:3000' },
  },
});
