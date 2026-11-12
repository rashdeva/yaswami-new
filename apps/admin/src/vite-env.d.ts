interface ImportMetaEnv {
  /** Адрес API. По умолчанию `/api` на том же домене. */
  readonly VITE_API_URL?: string;
  /** Только для разработки: токен админа из `pnpm api:token`. В сборку не попадает. */
  readonly VITE_DEV_TOKEN?: string;
}
