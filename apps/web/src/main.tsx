import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { api } from './api.ts';
import './app.css';
import { setLinkConfig } from './format.ts';
import { syncTheme, tg } from './tg.ts';

syncTheme();
void api.config().then(setLinkConfig, () => {}); // к моменту «поделиться» уже загрузится
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
