interface ImportMetaEnv {
  /** Адрес API. По умолчанию `/api` на том же домене. */
  readonly VITE_API_URL?: string;
  /** Имя бота без @ — для ссылки на событие вида t.me/<бот>/<приложение>?startapp=<id>. */
  readonly VITE_BOT_USERNAME?: string;
  /** Короткое имя мини-приложения из @BotFather. По умолчанию `app`. */
  readonly VITE_APP_NAME?: string;
  /** Только для разработки в обычном браузере: токен из `pnpm api:token`. В сборку не попадает. */
  readonly VITE_DEV_TOKEN?: string;
}
