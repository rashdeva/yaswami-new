import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/admin/', // сервер отдаёт сборку по /admin (apps/api/src/main.ts)
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  envDir: '../..', // один .env в корне; в браузер попадают только переменные VITE_*
  server: {
    port: 5174,
    // API_URL — когда порт 3000 занят API из другого worktree.
    proxy: { '/api': process.env.API_URL ?? 'http://localhost:3000' },
  },
});
