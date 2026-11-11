import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './app.css';
import { syncTheme, tg } from './tg.ts';

syncTheme();
try {
  tg?.ready();
  tg?.expand(); // на весь экран
} catch {
  // обычный браузер
}

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
