import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import './app.css';
import { router } from './router.tsx';
import { syncFullscreen, syncTheme, tg } from './tg.ts';

// Админка переписки — отдельная страница для компьютера: вне роутера, в мини-приложение её код не попадает.
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

// Ошибку показываем сразу, без повторов и без ожидания сети; при возврате во вкладку перечитывает только тот, кто сам попросил.
const always = { networkMode: 'always', retry: false } as const;
const queryClient = new QueryClient({ defaultOptions: { queries: { ...always, refetchOnWindowFocus: false, refetchOnReconnect: false }, mutations: always } });

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {isAdmin ? <Suspense><Admin /></Suspense> : <RouterProvider router={router} />}
    </QueryClientProvider>
  </StrictMode>,
);
