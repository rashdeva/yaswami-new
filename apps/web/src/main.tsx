import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './app.css';
import { syncFullscreen, syncTheme, tg } from './tg.ts';

// Админка переписки — отдельная страница для компьютера; в мини-приложение её код не попадает.
const isAdmin = location.pathname.startsWith('/admin');
const Admin = lazy(() => import('./admin/Admin.tsx'));
if (isAdmin) document.documentElement.classList.add('admin'); // admin.css снимает с #app колонку мини-приложения

syncTheme();
try {
  tg?.ready();
  tg?.expand();
  syncFullscreen();
} catch {
  // обычный браузер
}

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    {isAdmin ? <Suspense><Admin /></Suspense> : <App />}
  </StrictMode>,
);
