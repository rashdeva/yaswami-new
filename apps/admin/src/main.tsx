import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import * as z from 'zod';
import { Toaster } from '@/components/ui/sonner';
import './index.css';
import { router } from './router.tsx';

// Тексты ошибок проверки форм — по-русски (схемы из core работают на том же zod).
z.config(z.locales.ru());

// Тема — как в системе: shadcn включает тёмную классом `dark` на <html>.
const dark = matchMedia('(prefers-color-scheme: dark)');
const syncTheme = () => document.documentElement.classList.toggle('dark', dark.matches);
syncTheme();
dark.addEventListener('change', syncTheme);

// Ошибку показываем сразу, без повторов и без ожидания сети: лента и так перечитывается опросом.
const always = { networkMode: 'always', retry: false } as const;
const queryClient = new QueryClient({ defaultOptions: { queries: { ...always, refetchOnWindowFocus: false }, mutations: always } });

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster position="top-center" />
    </QueryClientProvider>
  </StrictMode>,
);
