import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  envDir: '../..', // один .env в корне; в браузер попадают только переменные VITE_*
  server: {
    port: 5173,
    // В разработке фронт ходит на /api так же, как в продакшене; Vite пересылает запросы локальному API.
    // API_PROXY=https://yaswami.com — посмотреть фронт на данных прода (публичные ручки, без входа).
    proxy: { '/api': { target: process.env.API_PROXY ?? 'http://localhost:3000', changeOrigin: true } },
  },
});
