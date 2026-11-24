# Приложение для iOS и Android (`apps/mobile`)

Expo SDK 58 и Expo Router. Нативные вкладки: на iOS 26 это Liquid Glass, на Android — Material 3. Системные цвета берутся через `Color` из `expo-router`: UIKit на iOS, Material You на Android. Шапки, поиск и диалоги — системные. Идентификатор — `app.yaswami` и в App Store, и в Google Play.

Данные берутся из того же API, что и у мини-приложения (`https://yaswami.com/api`), типы — из `@yaswami/core`. Правило то же, что в `apps/web`: экран рисует, хук знает.

```
src/
  api.ts       единственное место с fetch; Bearer-токен лежит в защищённом хранилище (Keychain / Keystore)
  session.ts   вход: Telegram (oauth.telegram.org в системном окне) и Apple; выход и удаление аккаунта
  queries.ts   все useQuery / useMutation экранов
  keys.ts      ключи запросов
  theme.ts     системные цвета платформы
  format.ts    чистые функции показа
  components/  то, что рисуют два экрана и больше
  app/         маршруты: _layout.tsx — вкладки, (index,hosts,me,search)/ — общий стек всех вкладок
```

Вход и удаление аккаунта на бэке описаны в ADR-0007 и `docs/agents/api.md`. «Войти через Apple» обязательно по правилу App Store 4.8, раз в приложении есть вход через Telegram. На Android вместо Apple — «Войти через Google»: кнопка появляется, когда при сборке задан `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`. Удалить аккаунт можно в «Мои» — этого требует правило 5.1.1(v).

## Разработка

```bash
pnpm install
cd apps/mobile
LANG=en_US.UTF-8 npx expo run:ios      # сборка для симулятора; без LANG падает CocoaPods
npx expo run:android
```

`ios/` и `android/` генерирует `expo prebuild`, в git их нет: нативные настройки задаются в `app.json`. Пакеты добавляются через `npx expo install <пакет>`. Типы проверяет `pnpm typecheck` в корне.

## Публикация только во Вьетнаме

Сборка и отправка идут через EAS (`eas.json`). Страны выбираются не в коде, а в консолях магазинов, один раз на приложение.

Один раз:

1. `npx eas-cli@latest login`, затем `npx eas-cli@latest init` в `apps/mobile`: в `app.json` появится `extra.eas.projectId`.
2. **App Store Connect**: My Apps → «+» → New App, bundle id `app.yaswami`; Apple создаст его сам при первой сборке EAS. Включи Sign in with Apple у этого App ID в Certificates, Identifiers & Profiles: EAS ставит его по `usesAppleSignIn`.
3. **App Store Connect → приложение → Pricing and Availability → Country or Region Availability**: снять все страны и оставить только **Vietnam**. Цена — Free.
4. **Google Play Console**: Create app «Я с вами», package `app.yaswami`. Первый `.aab` нужно загрузить руками: Play не принимает первую сборку через API.
5. **Play Console → Production → Countries/regions**: добавить только **Vietnam**. То же сделать для тестовых треков, если они открыты не только своим.
6. **Вход через Google** (Google Cloud Console → APIs & Services → Credentials, проект любой):
   - OAuth consent screen: External, название «Я с вами».
   - OAuth client ID типа **Web application** — его id идёт и в приложение, и на сервер.
   - OAuth client ID типа **Android**: package `app.yaswami` и SHA-1. Нужны два таких клиента: с SHA-1 ключа подписи из Play Console (App integrity → App signing) и с SHA-1 ключа загрузки EAS (`npx eas-cli@latest credentials -p android`). Для отладочной сборки — третий, с SHA-1 из `cd android && ./gradlew signingReport`.
   - В Railway: `GOOGLE_CLIENT_IDS=<web client id>`. В EAS: `npx eas-cli@latest env:create --name EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID --value <web client id> --environment production --visibility plaintext`.
7. Для `eas submit` на Android: сервисный аккаунт Google Cloud с доступом к Play Console. Его ключ кладётся в `apps/mobile/google-service-account.json` (файл в `.gitignore`).

Каждый релиз:

```bash
cd apps/mobile
npx eas-cli@latest build --platform all --profile production
npx eas-cli@latest submit --platform ios --latest      # в TestFlight, оттуда — на ревью
npx eas-cli@latest submit --platform android --latest  # во внутренний трек черновиком
```

Для ревью Apple в App Review Information нужен демо-доступ. Ревьюер войдёт через Apple на своём устройстве, поэтому логин и пароль не нужны. Но стоит написать, что приложение — каталог событий Дананга и что вход через Telegram — второй способ.

Иконки в `assets/` (`icon.png` без прозрачности, `expo.icon` для iOS 26, `android-icon-*.png`, `splash-icon.png`) отрисованы из `apps/web/public/mark.svg` на белом фоне.

В карточках обоих магазинов: Privacy Policy — `https://yaswami.com/privacy.html` (`apps/web/public/privacy.html`; меняешь, какие данные собираем, — правь и её), Support URL — `https://yaswami.com`.
