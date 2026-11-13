# Фронт (`apps/web`)

Мини-приложение Telegram и сайт. React 19 + Vite. Адреса — TanStack Router, данные с сервера — TanStack Query; другого менеджера состояния нет. Правило одно: **компонент рисует, хук знает, функция считает.**

Админка — отдельное приложение `apps/admin` со своим стеком оформления (shadcn/ui, Tailwind): `docs/agents/admin.md`. Сюда они не попадают: здесь свои компоненты и `tokens.css`.

## Где что лежит

```
src/
  api.ts          единственное место, где есть fetch; типы — из @yaswami/core
  main.tsx        вход: QueryClient и его настройки
  router.tsx      все маршруты кодом и страницы: страница берёт адрес и вход, раздаёт экрану props
  App.tsx         корневой layout: цвет шаблона, тост, кнопка «назад», Tabs; общее для страниц — через useShell()
  hooks/          useXxx.ts: useQuery/useMutation поверх api.*, подписки. Один хук — один ресурс или одно поведение
  hooks/keys.ts   все ключи запросов
  screens/        экран = композиция: берёт данные из хуков, раздаёт компонентам; про адреса не знает
  served.ts       данные, с которыми сервер отдал страницу (#initial)
  components/     то, что рисуют два экрана и больше; получает всё через props
  format.ts, …    чистые функции без React: форматирование, вывод одного из другого
  start.ts        разбор ?startapp=: событие, кто позвал (-r<id>), метка источника (-s<метка>)
  analytics.ts    PostHog: запуск, привязка к пользователю, именованные действия
  tokens.css      цвета, отступы, радиусы; в остальном CSS — только var(--…)
```

Кусок экрана, который нужен одному экрану, живёт в файле этого экрана. В `components/` он переезжает, когда понадобился второму.

## Правила

- **Запросы — только в хуках.** Компонент и экран вызывают `useEvent(id)`, `useRsvp(id)`, а `api.*` видят только файлы в `hooks/`. Хук отдаёт данные, состояние (`loading`, `failed`) и действия.
- **Загрузка — `useQuery`, изменение — `useMutation`.** Ключ запроса берётся из `hooks/keys.ts`. После изменения хук сам обновляет кэш: `setQueryData` ответом сервера или `invalidateQueries` — так, чтобы сошлись и сам ресурс, и списки, где он виден (событие и «мои события»). Данные со страницы и из уже загруженного списка — через `initialData`. Запрос «для учёта» (visit), чей ответ никому не нужен, — прямой вызов `api.*` в хуке с `.catch(() => {})`.
- **Маршрут — строка в `router.tsx`.** У каждого экрана свой адрес; переход — `navigate({ to, params })`, без `history` руками. Куда ведёт «назад», решает `App.tsx` по маршруту (родитель, а не history.back). Адрес `/e/$id` менять нельзя: его отдаёт сервер, он в sitemap.
- **Типы запросов и ответов — из `@yaswami/core`**, по сети — `Wire<T>`. Новая операция на бэке — новая строка в `api.ts` с тем же именем, что у сервиса.
- **Формы — `react-hook-form` со схемой zod из core** (`zodResolver(EventCreateInput)`): проверка на фронте и на бэке одна.
- **Правило домена — в `packages/core`.** Можно ли записаться, сколько мест, чей билет — функция из core, которую зовут и фронт, и бэк.
- **Вычисляемое считается при рендере.** Значение, которое выводится из props и состояния, — это `const`, а при тяжёлом расчёте `useMemo`.
- **`useEffect` — для внешнего мира**: подписка, таймер, Telegram WebApp, адресная строка. Эффект возвращает функцию очистки или ничего.
- **Текст ошибки для человека** — в `MESSAGES` в `api.ts`, по коду ошибки бэка. Новый код на бэке — новая строка там.
- **Telegram WebApp — через `tg.ts`**: остальной код работает и на сайте, и в мини-приложении.
- **Аналитика — через `analytics.ts`** (PostHog). Клики и переходы он ловит сам; шаг воронки — `track('…')`: результат — в `onSuccess` хука, показ экрана — `useViewed('…')`, нажатие — в обработчике. Имя добавляется в тип `Action` там же, рядом описаны сами воронки. Пользователь в PostHog — его Telegram id с именем и username. В разработке ничего не отправляется.
- **Открыто не всем — `useFeature('…')`**: список возможностей человека приходит с сервера в `/me`, экран по нему только прячет кнопку и адрес; отказ всё равно даёт сервер (`feature_off`). Страница решает, экран получает `null` вместо обработчика.
- **Эксперимент или выкатка — `useFlag('имя', значениеПоУмолчанию)`**: флаг PostHog. Значение по умолчанию — то, с чем приложение работает без PostHog (блокировщик, разработка, флаги ещё не пришли). Прав флагом не раздаём — для них возможность.
- **Размер — сигнал.** Экран длиннее ~150 строк или с пятью `useState` — повод вынести хук или компонент.

## Иконки тем

Иконка Topic — `apps/web/public/topics/<slug>.png`, 192×192, RGBA с настоящей прозрачностью; `slug` — из `TOPIC_GUIDES`. Новая тема без своей иконки не выкладывается: копия `other.png` в ленте неотличима от «другого».

Рисует Codex CLI (`image_generation` включена по умолчанию). В пустой папке вне репозитория, куда скопированы две-три существующие иконки как образец:

```bash
codex exec --skip-git-repo-check -s workspace-write -i art.png -i cinema.png -i games.png "<промпт>"
```

Промпт — на английском, по одному предмету на иконку:

```text
Use your image generation tool to draw a new icon in exactly the same style as the attached reference icons:
a single glossy 3D object that looks like translucent candy-glass or jelly, soft rounded shapes, bright highlights
and inner glow, one saturated colour family, slight three-quarter tilt, no text, no shadow on the ground,
fully transparent background, object fills about 85% of a square canvas.
<slug>.png — <предмет>, <цвет словами> (around <hex темы из tokens.css>).
Save as a 192x192 RGBA PNG with real alpha transparency into the current directory under exactly this name.
If the generator returns a larger image or an opaque background, remove the background and downscale with a script.
```

Предмет — один, узнаваемый в 40 px (шарик, а не «дети играют»); цвет — тот же, что у темы в `tokens.css`. Результат открой и сравни с соседними иконками, только потом клади в `public/topics`.

## Проверка

`pnpm typecheck`; затем открыть экран через превью `web` (`.claude/launch.json`) и пройти сценарий руками. Чистые функции и правила покрываются `*.test.ts` рядом с файлом (`node --test`).
