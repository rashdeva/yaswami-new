import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initAnalytics } from './analytics.ts';
import './app.css';
import { router } from './router.tsx';
import { syncFullscreen, syncTheme, tg } from './tg.ts';

initAnalytics();
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
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
