# Ingestion & Stack Feasibility (research)

Исследование рисковых, фактозависимых частей плана «Я с вами» по первичным источникам:
официальная документация, тексты Terms of Service, first-party pricing pages, исходники и спецификации.
Дата проведения: **2026-09-07**.

> **Дисклеймер.** Разделы про ToS и авторское право — это чтение опубликованных условий, а не юридическая
> консультация. Я не юрист и не даю оценку рисков правоприменения, юрисдикции, исковой перспективы
> или применимости GDPR к конкретной обработке. Всё, что помечено **НЕ ПРОВЕРЕНО**, first-party
> подтверждения не получило.

---

## Итоги

1. **Telegram прямо запрещает то, что заложено в план.** [Terms of Service for Content Licensing](https://telegram.org/tos/content-licensing) запрещает «scraping, indexing, harvesting, aggregation or use of data obtained from its platform to … deployment of artificial intelligence, machine learning models», а [Terms of Service for Bot Developers §4.3](https://telegram.org/tos/bot-developers) отдельно называет «scraping public group or channel contents» всегда запрещённым. Гипотеза плана подтверждена, а не опровергнута — Telegram-канал как источник в текущем виде нелегитимен.
2. **Instagram-скрейпинг нарушает Meta ToS явным текстом**, независимо от логина: [Meta Terms of Service §3.2.2](https://www.facebook.com/terms.php) запрещает собирать данные «using automated means (without our prior permission)», а [Automated Data Collection Terms](https://www.facebook.com/legal/automated_data_collection_terms) разрешают собранные данные только для поисковой выдачи и превью URL — наш кейс туда не попадает.
3. **Официального API для чтения чужого публичного Instagram практически нет.** [Instagram Basic Display API выключен 4 декабря 2024](https://developers.facebook.com/blog/post/2024/09/04/update-on-instagram-basic-display-api/); остаётся [Business Discovery](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/business_discovery/) и [Hashtag Search](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-hashtag-search/) — оба требуют Advanced Access + Business Verification, а hashtag search ограничен «a maximum of 30 unique hashtags within a 7 day period».
4. **Стоимость скрейпинга — не проблема; проблема — юридическая.** Apify `instagram-profile-scraper` возвращает до 12 последних постов внутри одного оплачиваемого результата ([actor page](https://apify.com/apify/instagram-profile-scraper)), поэтому 40 профилей ежедневно укладываются в тариф $19/мес; Bright Data — $1.5/1K records ([pricing](https://brightdata.com/pricing/web-scraper)). Оба вендора контрактно перекладывают ответственность на нас.
5. **Google Geocoding контрактно исключён сразу по трём пунктам:** хранение lat/lng только «up to 30 consecutive calendar days» ([Maps Service Terms §6.3.1](https://cloud.google.com/maps-platform/terms/maps-service-terms)), запрет использовать результаты «in conjunction with a non-Google map» (§6.2, а у нас MapLibre) и прямое упоминание «listings or directory service» среди запрещённых применений ([ToS §3.2.3](https://cloud.google.com/maps-platform/terms/)); чистые пути — self-hosted Nominatim на экстракте Грузии или [MapTiler](https://www.maptiler.com/terms/cloud/), который явно разрешает «usage outside of the Service».
6. **Бесплатные тайлы для коммерческого продукта — только два варианта.** MapTiler Free «Suitable for testing, personal or non-commercial use» ([pricing](https://www.maptiler.com/cloud/pricing/)), тогда как [OpenFreeMap](https://openfreemap.org/) разрешает коммерческое использование без лимитов, но живёт на донаты и без SLA, а [Protomaps PMTiles](https://docs.protomaps.com/) self-hosted даёт ~$5/мес и никакой зависимости от чужих квот.
7. **TanStack Start ещё не 1.0**: официально «currently in the Release Candidate stage» ([docs](https://tanstack.com/start/latest/docs/framework/react/overview)) — SSR, server routes и управление `<head>` есть, но это RC, а не stable.
8. **SEO: агрегаторам Event-разметка не запрещена, но только на страницах отдельных событий** — «The event experience on Google only supports pages that focus on a single event» ([Event docs](https://developers.google.com/search/docs/appearance/structured-data/event)); при этом весь каталог машинно-собран, а [spam policies](https://developers.google.com/search/docs/essentials/spam-policies) относят к «scaled content abuse» «scraping feeds … to generate many pages … where little value is provided» — защита строится на добавленной ценности и ссылке на первоисточник, а не на объёме.
9. **LLM-обработка дешёвая.** При Claude Haiku 4.5 ($1/$5 за 1M токенов) и постере ~1000×1000 px (1296 visual tokens) себестоимость структурирования одного события — порядка десятых цента; месячный бюджет на тысячах событий — единицы-десятки долларов (§7).

---

## 1. Юридическая часть: ToS источников и авторские права

### 1.1 Meta / Instagram

**Запрет автоматического сбора — прямым текстом.**
[Meta Terms of Service §3.2.2](https://www.facebook.com/terms.php) содержит запрет собирать данные из продуктов Meta
или получать к ним доступ «using automated means (without our prior permission)», и уточняет, что запрет действует
независимо от того, залогинен ли собиратель. То же в [Instagram Terms of Use](https://help.instagram.com/581066165581870/):
нельзя «access or collect information in an automated way without express permission», «regardless of whether such
automated access or collection is undertaken while logged-in to an Instagram account». *(Страница Instagram Help Center
рендерится через JS и не отдаётся ботам — текст подтверждён через индекс поиска по домену help.instagram.com;
формулировка помечена как **НЕ ПРОВЕРЕНО** дословно, но идентична формулировке Meta ToS.)*

**Отдельный документ про автоматический сбор.** [Automated Data Collection Terms](https://www.facebook.com/legal/automated_data_collection_terms)
определяют Automated Data Collection как сбор через «web scrapers, bots, robots, spiders, crawlers, user-agents»
и разрешают использовать Collected Data только для «(i) providing results for your Search Engine, or (ii) displaying
previews of Meta URLs to your users, and (iii) for other purposes for which you have received Meta's express written
permission». Агрегатор событий не является поисковой системой в этом смысле; передача/лицензирование Collected Data
третьим лицам запрещена. То есть даже «легальный» путь Meta — это путь для поисковиков, а не для нас.

**Что даёт официальный API.**

| Возможность | Статус | Ограничения |
|---|---|---|
| Instagram Basic Display API | **Выключен** «Starting on December 4th, 2024 … will no longer be available» ([blog](https://developers.facebook.com/blog/post/2024/09/04/update-on-instagram-basic-display-api/)) | все запросы падают |
| Instagram API with Instagram Login / with Facebook Login | Работает | «Requires an Instagram Business or Creator Account» — доступ только к аккаунтам, которые нам дал сам организатор ([Instagram Platform](https://developers.facebook.com/docs/instagram-platform/)) |
| Business Discovery | Работает | нужен собственный IG Business/Creator аккаунт, permissions `instagram_basic` + `instagram_manage_insights` + `pages_read_engagement`, целевой аккаунт по `username`; «Data about age-gated Instagram Business IG Users will not be returned» ([reference](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/business_discovery/)) |
| Hashtag Search | Работает | «You can query a maximum of 30 unique hashtags within a 7 day period»; требует feature *Instagram Public Content Access* ([reference](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-hashtag-search/)) |
| oEmbed | Работает | «up to 1,000 requests every hour»; «only meant to be used for embedding Instagram content in websites and apps. It is not to be used for any other purpose» ([docs](https://developers.facebook.com/docs/instagram-platform/oembed/)) |

Всё «advanced» требует прохождения ревью: «Your app must complete Meta App Review to be granted Advanced Access»,
и Advanced Access — «the access level required if your app serves Instagram professional accounts that you don't own
or manage», плюс обязательная Business Verification ([Overview](https://developers.facebook.com/docs/instagram-platform/overview/)).

**Важный вывод про Business Discovery:** технически он умеет отдавать публичные поля медиа чужого бизнес-аккаунта
через field expansion — это единственный официальный путь читать чужие публичные посты. Но он требует App Review,
Business Verification и подпадает под Platform Rate Limits; и он не отменяет запрет ToS на «collect information in
an automated way» в отношении данных, полученных вне API.

**Instagram Stories.** Первичной документации на чтение Stories чужого аккаунта не найдено: Business Discovery
такого поля не документирует, а Story insights «only available for Instagram API with Facebook Login» и относятся
к собственному аккаунту ([Insights](https://developers.facebook.com/docs/instagram-platform/insights/)).
Вывод: **официального пути нет**, вендорские возможности — **НЕ ПРОВЕРЕНО**, только эмпирический пилот.

**oEmbed как компромисс.** Единственный официально одобренный способ показать пост Instagram на нашем сайте —
встроить его через oEmbed. Это решает вопрос отображения контента, но не вопрос его автоматического сбора,
и явно ограничено целью «embedding» — не «building a catalog».

### 1.2 Telegram — план ошибался только в оптимизме

Гипотеза «в Telegram есть пункт про AI/ML» **подтверждается тремя независимыми документами**.

1. [Terms of Service for Content Licensing](https://telegram.org/tos/content-licensing) — раздел *Large Language Models and AI*:
   > «Telegram firmly prohibits the scraping, indexing, harvesting, aggregation or use of data obtained from its platform
   > to train, fine-tune, validate or otherwise engage in the development, enhancement, benchmarking or **deployment**
   > of artificial intelligence, machine learning models and similar technologies.»

   Слово *deployment* критично: запрет не сводится к обучению моделей. Прогон чужого LLM по собранным постам
   попадает под формулировку буквально. Исключение возможно только там, где «all relevant users individually provide
   explicit, informed, affirmative and continued consent», причём «consent obtained in one context is non-transferable».

2. [Terms of Service for Bot Developers §4.3 «Data Scraping»](https://telegram.org/tos/bot-developers):
   > «You agree not to use your TPA to collect, store, aggregate or process data beyond what is essential for the
   > operation of your services. Always prohibited uses include any form of data collection aimed at creating large
   > datasets, machine learning models and AI products, **such as scraping public group or channel contents**.»

   Здесь публичные каналы названы прямо. Единственная разрешённая база — данные, «submitted directly and voluntarily
   to your TPA by users» с явным согласием.

3. [Telegram API Terms of Service §1.5](https://core.telegram.org/api/terms) повторяет запрет для MTProto-клиентов
   и ссылается на документ выше.

Дополнительно [Telegram API ToS](https://core.telegram.org/api/terms) в §1 адресован «third-party client apps»,
то есть мессенджерам-клиентам, а не парсерам; §3.3 требует: «If your app allows accessing content from Telegram
channels, you must include support for official sponsored messages in Telegram channels and may not interfere with
this functionality» — юзербот-парсер это требование не выполняет по определению.

**Практический вывод.** Telegram-каналы как источник для машинного каталога — не серая зона, а прямо запрещённая
активность по трём документам сразу. Легитимные варианты, которые остаются:
- организатор сам присылает анонс боту (это «data submitted directly and voluntarily … with explicit consent» по §4.3);
- бот добавлен в канал как участник/админ, и организатор дал явное согласие на обработку — но тогда это уже
  онбординг организаторов, чего V1 старался избежать.

### 1.3 Механика чтения Telegram (если бы это было разрешено)

Для полноты — что технически возможно, независимо от ToS.

**Bot API.** Бот получает «All messages from channels where they are a member» ([Bots FAQ](https://core.telegram.org/bots/faq)).
То есть **бот не может читать публичный канал, не будучи в него добавлен** — админом быть не обязательно, но членом
канала быть нужно, а добавить бота в канал может только его владелец. Никакого «читаю любой публичный канал по
username» в Bot API нет.

**MTProto (userbot).** Технически даёт `messages.getHistory` и апдейты. Изменения и удаления детектируются через
`updateEditChannelMessage` и `updateDeleteChannelMessages`, а пропуски восстанавливаются механизмом `pts` /
`updates.getChannelDifference` ([Updates](https://core.telegram.org/api/updates)) — то есть «freshness control»
для отредактированных и удалённых анонсов в принципе реализуем корректно.

**Числовые лимиты Telegram не публикует.** В [Error handling](https://core.telegram.org/api/errors) документирован
только код `420` с `FLOOD_WAIT_%d` («Please wait %d seconds before repeating the action») и `SLOWMODE_WAIT_%d` —
конкретных значений RPS/сутки нет. Значит, любая оценка пропускной способности userbot-подхода — **эмпирическая,
first-party числа отсутствуют**.

Ограничения Bot API на отправку (важно, если позже появятся уведомления):
«In a single chat, avoid sending more than one message per second», «bots are not able to broadcast more than about
30 messages per second, unless they enable paid broadcasts» ([Bots FAQ](https://core.telegram.org/bots/faq)).

### 1.4 Авторские права и права на базу данных — высокоуровнево

**Что я НЕ могу оценить:** применимую юрисдикцию, статус нашей обработки под GDPR, риск претензий конкретных
правообладателей, лицензионные последствия распространения постеров. Это вопросы к юристу.

Что видно из текстов законов:

- **Факты о событиях не охраняются.** [Закон Грузии «Об авторском праве и смежных правах» № 2112-IIS](https://matsne.gov.ge/en/document/view/16198)
  исключает из охраны идеи, методы, принципы и факты; ст. 8 отдельно исключает «information about facts and events»
  ([WIPO Lex запись](https://www.wipo.int/wipolex/en/legislation/details/22704)). То есть «дата, время, место,
  цена, тема» — это факты, и их извлечение и переизложение своими словами наиболее безопасная стратегия.
- **Дословный текст анонса и постер — охраняемые объекты.** Копирование caption целиком и хостинг чужого изображения
  — это воспроизведение произведения. Ст. 23 того же закона даёт исключение для цитирования «only in the volume
  justified by the citing purpose» с указанием источника — то есть короткая цитата с атрибуцией и ссылкой на
  оригинал защищена лучше, чем полная копия.
- **Права на базу данных.** Закон Грузии признаёт смежные права производителей баз данных (ст. 19 и далее,
  [WIPO Lex](https://www.wipo.int/wipolex/en/legislation/details/22704)); в ЕС это [Directive 96/9/EC](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A31996L0009) —
  sui generis право против «extraction and/or re-utilization of the whole or of a substantial part» базы.
  Массовый съём всех анонсов одного источника ближе к «substantial part», чем выборочная индексация.
- **TDM-исключение ЕС и opt-out.** [Directive (EU) 2019/790, Art. 4](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32019L0790)
  разрешает text and data mining при условии, что материал «accessed lawfully» и правообладатель не зарезервировал
  права; резервирование делается «machine-readable means, including metadata and **terms and conditions of a website
  or a service**». Ключевой момент: ToS Meta и Telegram — это ровно такое резервирование, поэтому TDM-исключение
  здесь не спасает. Кроме того, Грузия не член ЕС; применимость директив к грузинскому юрлицу — **вопрос к юристу**.
- Ст. 15 той же директивы (право издателей прессы) не распространяется на «individual words or very short extracts»
  и на «acts of hyperlinking» — аргумент в пользу модели «короткий тизер + ссылка на первоисточник».

**Практическая рекомендация из чтения текстов:** хранить и показывать извлечённые факты + собственную короткую
формулировку + ссылку на оригинал; не хостить чужие постеры, а либо встраивать oEmbed, либо показывать только
собственную обложку/типографику. Это одновременно снимает и вопрос протухающих CDN-ссылок (§2).

---

## 2. Вендоры Instagram-скрейпинга

### 2.1 Apify

Тарифы ([apify.com/pricing](https://apify.com/pricing)): Free $0 ($5/мес включённого потребления, помечен
«Limited (trial only)» для арендуемых акторов), Starter **$19/мес**, Scale $199, Business $999.
Лимиты платформы — [docs.apify.com/platform/limits](https://docs.apify.com/platform/limits): суммарная память
16 / 64 / 256 / 512 GB по тарифам. *(На странице pricing указано 5 concurrent runs на Free, в limits — 25;
расхождение между двумя first-party страницами, **НЕ ПРОВЕРЕНО**, что верно.)*

Цены первых-party акторов:

| Актор | Free | Starter | Scale | Business |
|---|---|---|---|---|
| [apify/instagram-scraper](https://apify.com/apify/instagram-scraper) | $2.70/1k | $2.30/1k | $1.90/1k | $1.50/1k |
| [apify/instagram-post-scraper](https://apify.com/apify/instagram-post-scraper) | $2.70/1k | $2.30/1k | «from $1.00 / 1,000 posts» (заявлено в заголовке) | |
| [apify/instagram-profile-scraper](https://apify.com/apify/instagram-profile-scraper) | $2.60/1k | $2.30/1k | «from $1.60 / 1,000 profiles» | |

Модель оплаты — pay-per-event: «You are not charged for the Apify platform usage, but only a fixed price for
specific events» ([API tab](https://apify.com/apify/instagram-scraper/api)).

**Поля вывода** (instagram-scraper): `id`, `shortCode`, `caption`, `hashtags`, `mentions`, `url`, `commentsCount`,
`likesCount`, `timestamp`, `ownerUsername`, `ownerId`, `displayUrl`, `dimensionsHeight/Width`. Всё нужное —
текст, время, ссылка, картинка — присутствует.

**Ключевая находка по стоимости:** `instagram-profile-scraper` возвращает поле `latestPosts` — «the latest 12 posts
with details» внутри **одного** оплачиваемого результата. Это делит счёт на 12. *(Точный набор вложенных полей и
гарантированность цифры 12 — **НЕ ПРОВЕРЕНО**, проверять на пилоте.)*

**Инкрементальность:** входной параметр `onlyPostsNewerThan` принимает `YYYY-MM-DD`, ISO или относительные значения
(`1 day`), «Times are in UTC, not local time» ([input schema](https://apify.com/apify/instagram-scraper/input-schema)) —
то есть за уже собранные посты можно не платить повторно.

**Срок жизни ссылок на изображения — не документирован.** Ни один из акторов не описывает, сколько живут
`scontent-*.cdninstagram.com` URL. **НЕ ПРОВЕРЕНО**; практический вывод — перекладывать изображения к себе на
ingest или не хранить их вовсе (см. §1.4).

**Ответственность.** [General Terms and Conditions](https://docs.apify.com/legal/general-terms-and-conditions):
«You are solely responsible for the legality, accuracy, quality, appropriateness, and use of all Customer Data»;
«Should you use the Services or Actors to extract Customer Data from unauthorized sources, you shall be responsible
for compensating any damages». [Acceptable Use Policy](https://docs.apify.com/legal/acceptable-use-policy) запрещает
фрод и «actions that cause undue burden on any servers», но про персональные данные и копирайт не говорит — эти
темы живут только в T&C. Публичная позиция «is web scraping legal» опубликована в блоге, а не в юридическом
документе, — это маркетинг, не контракт.

### 2.2 Bright Data

Цены ([brightdata.com/pricing/web-scraper](https://brightdata.com/pricing/web-scraper)):
free tier 5,000 records/мес; pay-as-you-go **$1.5/1K records**; Scale $499/мес за 384,000 записей и $1.3/1K сверх.
«Only pay for what's successfully delivered.» Минимального депозита на странице не заявлено — **НЕ ПРОВЕРЕНО**,
существует ли он на практике.

**Поля** (Instagram Posts, [product page](https://brightdata.com/products/web-scraper/instagram/posts)):
`url`, `user_posted`, `description` (= caption), `hashtags`, `num_comments`, `date_posted`, `likes`, `photos`.
API принимает до 20 URL в синхронном запросе ([docs](https://docs.brightdata.com/products/scrapers/instagram/introduction)).
Конкретные `dataset_id` и полный словарь полей в публичных доках не раскрыты — **НЕ ПРОВЕРЕНО**.
Срок жизни CDN-ссылок так же не документирован — **НЕ ПРОВЕРЕНО**.

**Комплаенс жёстче, чем у Apify.** [Acceptable Use Policy](https://brightdata.com/acceptable-use-policy) прямо
запрещает «Collection of nonpublic information (i.e. data behind login)». [MSA](https://brightdata.com/license)
вводит обязательный KYC: «Certain Services will be made available subject to Bright Data's completion of a successful
compliance review process of the Client», плюс перекладывает на клиента определение правового основания обработки
персданных и индемнити по IP-претензиям.

### 2.3 Оценка стоимости: 40 профилей ежедневно

Допущения: 30 дней в месяце, только first-party цены.

**Вариант A — 40 профилей × 12 постов/день = 480/день = 14,400 результатов/мес**

| Опция | Арифметика | Итого/мес |
|---|---|---|
| Apify Starter, instagram-scraper @ $2.30/1k | 14,400 × $0.0023 = $33.12 | **~$33** |
| Apify Starter, **profile-scraper** (12 постов в одном результате) | 1,200 × $0.0023 = $2.76 → внутри включённых $19 | **$19** (пол тарифа) |
| Bright Data PAYG @ $1.5/1k | 14,400 × $0.0015 = $21.60 | **~$22** |

**Вариант B — 40 профилей × 5 постов/день = 6,000/мес**

| Опция | Арифметика | Итого/мес |
|---|---|---|
| Apify Starter @ $2.30/1k | 6,000 × $0.0023 = $13.80 → внутри $19 | **$19** |
| Bright Data PAYG @ $1.5/1k | 6,000 × $0.0015 = $9.00 | **~$9** |

**Вывод: деньги — не фактор решения.** Разница между вендорами $10–15/мес. Реальные факторы: (а) `onlyPostsNewerThan`
у Apify реально снижает счёт при ежедневном опросе; (б) вложенные `latestPosts` делают Apify практически бесплатным
на уровне $19; (в) Bright Data требует пройти compliance review до выдачи доступа; (г) ни один вендор не документирует
время жизни CDN-ссылок; (д) **оба вендора контрактно оставляют юридический риск на нас** (§1.1).

---

## 3. Механика ингеста Telegram

Сведено в §1.2–1.3 выше, поскольку неотделимо от ToS. Кратко:

- **Bot API не решает задачу**: бот видит сообщения только тех каналов, где он состоит участником
  ([Bots FAQ](https://core.telegram.org/bots/faq)) — то есть нужен доступ, который выдаёт владелец канала.
- **MTProto технически решает**, включая корректную детекцию правок/удалений (`updateEditChannelMessage`,
  `updateDeleteChannelMessages`, восстановление по `pts` через `updates.getChannelDifference`,
  [Updates](https://core.telegram.org/api/updates)), но **прямо запрещён** ToS для нашей цели.
- **Числовых лимитов Telegram не публикует** — только `420 FLOOD_WAIT_%d` без значений
  ([Error handling](https://core.telegram.org/api/errors)).

---

## 4. Проверка стека

### 4.1 TanStack Start

- **Статус: Release Candidate, не 1.0.** Документация: «currently in the Release Candidate stage», API «considered
  stable» ([overview](https://tanstack.com/start/latest/docs/framework/react/overview)). Версия пакета
  `@tanstack/react-start` — **1.168.50** ([npm registry](https://registry.npmjs.org/@tanstack/react-start/latest)),
  релизы идут поездами ([GitHub releases](https://github.com/TanStack/router/releases)).
- **SSR и streaming.** «Full-document SSR» и «Streaming» заявлены в overview. Пороутовое управление —
  опция `ssr`: `true` (по умолчанию), `false`, `'data-only'`; дочерние маршруты наследуют режим и могут его
  только ужесточить ([Selective SSR](https://tanstack.com/start/latest/docs/framework/react/guide/selective-ssr)).
  Отдельный гайд по streaming SSR прочитать не удалось (404) — детали Suspense/deferred data **НЕ ПРОВЕРЕНО**.
- **Server functions**: `createServerFn().handler(...)`, код вырезается из клиентского бандла, вызовы становятся
  `fetch`, защищены CSRF-middleware ([docs](https://tanstack.com/start/latest/docs/framework/react/guide/server-functions)).
- **Server routes** — то, что нужно для `sitemap.xml`, `robots.txt` и публичного API: `server.handlers` в
  `createFileRoute`, документация прямо рекомендует их для «endpoints that need to be called from outside your
  TanStack Start application» ([docs](https://tanstack.com/start/latest/docs/framework/react/guide/server-routes)).
- **SEO-история закрывается.** `routeOptions.head` возвращает `{ title, meta, links, styles, scripts }`;
  `scripts` принимает inline-содержимое через `children` — это и есть механизм вставки JSON-LD. Title/meta
  дедуплицируются по вложенности, побеждает последнее ([Document Head Management](https://tanstack.com/router/latest/docs/framework/react/guide/document-head-management)).
  Явного примера с `type: 'application/ld+json'` в доках не найдено — механизм подтверждён, конкретный пример
  **НЕ ПРОВЕРЕНО**.
- **Деплой** ([hosting](https://tanstack.com/start/latest/docs/framework/react/guide/hosting)): официальные партнёры
  Cloudflare Workers, Netlify, Railway; также документированы Nitro, Vercel, Node.js/Docker, Bun, Appwrite Sites.
  ISR документирован отдельно ([ISR](https://tanstack.com/start/latest/docs/framework/react/guide/isr)).

**Вердикт:** SEO-история плана поддерживается. Риск — RC-статус и высокий темп релизов; закладывать бюджет на
поддержание версий.

### 4.2 MapLibre GL JS и тайлы

**MapLibre GL JS: v6.** Текущий релиз **6.7.0 (2026-09-02)**, мажор 6.0.0 вышел 2026-07-22
([releases](https://github.com/maplibre/maplibre-gl-js/releases)). То есть мажор свежий — ожидать шероховатостей.

**Кластеризация встроенная** ([style spec: sources](https://maplibre.org/maplibre-style-spec/sources/)):
`cluster` (default `false`), `clusterRadius` (default 50), `clusterMaxZoom`, `clusterMinPoints` (default 2),
`clusterProperties` (агрегаты `"+"`, `"max"`, reduce-выражения). Рантайм-API `GeoJSONSource`:
`getClusterExpansionZoom`, `getClusterChildren`, `getClusterLeaves(clusterId, limit, offset)`
([API docs](https://maplibre.org/maplibre-gl-js/docs/API/classes/GeoJSONSource/)) — последнее ровно закрывает
сценарий «клик по кластеру → список событий».

Перф-рекомендации ([Large data](https://maplibre.org/maplibre-gl-js/docs/guides/large-data/)): округлять координаты
до ~6 знаков, «For most point sources, a maxZoom value of 12 strikes a good balance between precision and speed»,
использовать кластеризацию, при росте объёма — переходить на серверный тайлинг.

**Тайл-провайдеры — сравнение по first-party условиям**

| Провайдер | Коммерческое использование на free | Количественные лимиты | Цена входа | Атрибуция |
|---|---|---|---|---|
| [MapTiler](https://www.maptiler.com/cloud/pricing/) | **Нет.** Free «Suitable for testing, personal or non-commercial use» | Free: 5k map sessions, 100k API requests/мес | Flex **$30/мес** (25k map sessions, 500k API requests) — там коммерция разрешена | «© MapTiler» **с логотипом**, плюс «© OpenStreetMap»; должна быть «always visible and readable» ([terms](https://www.maptiler.com/terms/)) |
| [OpenFreeMap](https://openfreemap.org/) | **Да, явно.** «Using our public instance is completely free: there are no limits on the number of map views or requests» | Лимитов нет | $0 | «OpenFreeMap © OpenMapTiles Data from OpenStreetMap» |
| [Protomaps](https://docs.protomaps.com/) (self-host PMTiles) | **Да**, ODbL Produced Work | Свои — упираются в bucket/CDN | ~**$5/мес** на Cloudflare со scale-to-zero ([deploy](https://docs.protomaps.com/deploy/)) | «Protomaps © OpenStreetMap» ([maplibre](https://docs.protomaps.com/basemaps/maplibre)) |
| [Stadia Maps](https://stadiamaps.com/pricing/) | **Нет** на free (200k credits/мес) | — | Starter $20/мес | — |

**Про OpenFreeMap как риск:** MIT, планета перегенерируется еженедельно, но проект живёт на донатах —
«The nature of this project needs recurring donations to cover the server costs», SLA и персональной поддержки нет
([openfreemap.org](https://openfreemap.org/), [GitHub](https://github.com/hyperknot/openfreemap)). Он же явно
**не даёт** геокодинг/поиск, роутинг, растровые тайлы и спутник.

**Про Protomaps:** формат PMTiles — «an open archive format for pyramids of tile data, accessible via HTTP Range
Requests», то есть один файл в object storage без тайл-сервера. Планета ≈ **120 GB** на z0–15, «each additional zoom
level roughly doubles the size» ([downloads](https://docs.protomaps.com/basemaps/downloads)). Экстракт Грузии
делается без скачивания планеты: `pmtiles extract https://…/planet.pmtiles georgia.pmtiles --bbox=… --maxzoom=14`
([CLI](https://docs.protomaps.com/pmtiles/cli)). Размер экстракта Грузии — **НЕ ПРОВЕРЕНО** (first-party цифры нет).

**Покрытие Грузии.** Все четыре — производные OSM, поэтому источник данных один. Protomaps честно предупреждает,
что базовая карта «does not include all data and tags from OSM … a balance between tile size and completeness»
([downloads](https://docs.protomaps.com/basemaps/downloads)). **First-party утверждений о качестве данных
именно по Грузии и покрытии грузинских названий (`name:ka` vs `name:en`) ни у одного вендора нет — НЕ ПРОВЕРЕНО**,
проверяется только эмпирически на Тбилиси/Батуми/Казбеги.

**Рекомендация:** Protomaps PMTiles с экстрактом Грузии как основной вариант (нет чужих квот, коммерчески чист,
~$5/мес); OpenFreeMap как быстрый старт с готовым fallback-стилем; MapTiler Flex $30 — если нужен управляемый сервис.

### 4.3 Геокодинг грузинских адресов

Приложению нужно **постоянно хранить lat/lng у себя**. Это и есть главный фильтр при выборе провайдера —
не цена и не покрытие.

#### Nominatim (публичный инстанс OSMF)

[Usage Policy](https://operations.osmfoundation.org/policies/nominatim/) — жёсткая:

- «No heavy uses (an absolute maximum of **1 request per second**)».
- «Provide a valid HTTP Referer or User-Agent identifying the application (stock User-Agents as set by http
  libraries will not do)».
- **Кэширование обязательно, а не разрешено:** «Results must be cached on your side. Clients sending repeatedly
  the same query may be classified as faulty and blocked». То есть хранение координат у себя — требование политики.
- «As a general rule, bulk geocoding of larger amounts of data is not encouraged».
- Запрещено, среди прочего: «Systematic queries» и «**Reselling of geocoding results** — Applications and services
  whose primary function is related to geocoding must run their own service».

Наш продукт геокодингом не торгует, поэтому пункт про reselling скорее не применим, но непрерывный конвейер —
это ровно «bulk / systematic» паттерн, а 1 req/s делает публичный инстанс непригодным как основной геокодер.

**Self-hosting — реальный выход.** [Installation](https://nominatim.org/release-docs/latest/admin/Installation/):
«A minimum of 2GB of RAM is required»; полная планета — 128 GB RAM и ≥1 TB диска. Но
[Import](https://nominatim.org/release-docs/latest/admin/Import/): «If you only need geocoding for a smaller region,
then precomputed OSM extracts are a good way to reduce the database size and import time. Geofabrik offers extracts
for most countries», с оговоркой «some extracts are not cut exactly along the country boundaries».
**Экстракт Грузии умещается в небольшую VM — ни лимитов, ни ToS.**

Лицензия данных — ODbL ([OSM copyright](https://www.openstreetmap.org/copyright)): нужно «Provide credit to
OpenStreetMap» и «Make clear that the data is available under the Open Database License»; share-alike действует,
если «you alter or build upon our data». Различие Produced Work / Derived Database (то есть: показывать координаты
на сайте vs выкладывать дамп своей геокодированной базы) на странице /copyright не раскрыто — **НЕ ПРОВЕРЕНО**
first-party, живёт в тексте самой ODbL.

#### Google Geocoding — контрактно исключён, и не только из-за 30 дней

[Google Maps Platform ToS §3.2.3](https://cloud.google.com/maps-platform/terms/):

- (a) No Scraping: «Customer will not … (i) pre-fetch, index, store, reshare, or rehost Google Maps Content outside
  the services; (ii) bulk download … geocodes».
- (d) No Re-Creating Google Products or Features — прямо перечисляет «use the Google Maps Core Services **in a
  listings or directory service**». Каталог событий сюда попадает почти дословно.
- (e) No Use With Non-Google Maps: «Customer will not use the Google Maps Core Services with or near a non-Google Map».

[Maps Service Specific Terms §6](https://cloud.google.com/maps-platform/terms/maps-service-terms):

- §6.2: «Customer must not use Google Maps Content from the Geocoding API in conjunction with a non-Google map».
- §6.3.1: «Customer may temporarily cache latitude (lat) and longitude (lng) values from the Geocoding API for up to
  **30 consecutive calendar days**, after which Customer must delete the cached latitude and longitude values».
- §6.3.2 (бессрочное исключение): кэшировать бессрочно можно «solely to support the direct, End User facing
  functionality of the Customer Application», причём «Cached data must be **logically isolated to the specific End
  User** it is associated with and must not be used across multiple End Users».

**Исключение §6.3.2 нам не подходит:** общая таблица координат площадок, отдаваемая всем посетителям, по определению
«used across multiple End Users». Исключение про Place ID (General Service Terms §3, «Google ID Caching») покрывает
`place_id`, `pano_ID`, `video_ID` — **не** lat/lng.

Итого — тройное нарушение: хранение >30 дней, отрисовка результатов на не-Google-карте (MapLibre) и характер
продукта как «listings or directory service». **Google исключается.**

Цены для полноты ([pricing](https://developers.google.com/maps/billing-and-pricing/pricing), обновлено 2026-08-31):
Geocoding SKU `BAC8-4E68-E261`, бесплатный порог 10,000/мес, далее **$5.00 за 1,000** до 100k. Прежний общий кредит
$200/мес в текущем прайсе отсутствует — теперь помесячный бесплатный лимит на каждый SKU.

#### Mapbox

Есть отдельный платный продукт: **Permanent Geocoding API** — «Permanently store forward and reverse search results,
make batch geocoding requests, or both», но «Results from the Permanent Geocoding API are only available for your own
personal or business use, and **cannot be used for distribution or sublicense**» ([pricing](https://www.mapbox.com/pricing)).
Цена — **$5.00 за 1,000** (1–500k), бесплатного тира нет, доступ через sales. Temporary Geocoding — бесплатно до
100,000/мес, далее $0.75/1,000, но без права постоянного хранения.

Формулировка «cannot be used for distribution» неоднозначна для публичного SEO-сайта, показывающего координаты.
Точный текст контрактного разрешения на permanent storage за пределами прайс-страницы вычитать не удалось —
**НЕ ПРОВЕРЕНО**; вопрос к Mapbox sales до принятия решения.

#### MapTiler — самый явный разрешительный текст

[Cloud Terms](https://www.maptiler.com/terms/cloud/):

- «**Results of the search services, such as Geolocation API, Geocoding API and Routing API, are allowed for usage
  outside of the Service.**»
- «Only bulk downloading allowed is for the Geocoding API service.»
- Атрибуция для созданной базы: «The attribution of the database created has to be clearly marked either as part of
  the database or in a separate file attached to the database».
- Запрет «to store, save, and/or redistribute any **map content** from a server-side cache» относится к тайлам,
  не к результатам поиска.

Тарифы — те же, что для тайлов: Free только non-commercial, **Flex $30/мес**. Точные квоты геокодинга по тарифам
рендерятся клиентским JS и вычитать их не удалось — **НЕ ПРОВЕРЕНО**.

#### Провайдеры, явно разрешающие постоянное хранение

**LocationIQ** — самая недвусмысленная формулировка. Хранение адресов/координат из вывода API разрешено
([help](https://help.locationiq.com/support/solutions/articles/36000216111-can-i-save-addresses-from-api-output-));
про кэш: подписчикам — «you can cache for as long as you're subscribed with us», на free — «we allow caching for
upto 48 hours» ([help](https://help.locationiq.com/support/solutions/articles/36000216698-can-i-cache-the-results-)).
Тарифы ([pricing](https://locationiq.com/pricing)): Free 5,000 req/day @2 req/s; Developer $100/мес — 25,000/day @20 req/s;
Startup $200/мес; Growth Plus $500/мес; Business Plus $950/мес. **Оговорка:** право на хранение привязано к активной
подписке.

**Geoapify** — маркетинговые страницы заявляют неограниченное хранение, но в
[Terms and Conditions](https://www.geoapify.com/terms-and-conditions/) **пункта про кэширование/хранение/распространение
результатов нет вообще**. Атрибуция обязательна: «you must always provide OpenStreetMap attribution», плюс
«Geoapify attribution is mandatory when using Free subscription plan». Разрешение на постоянное хранение —
**НЕ ПРОВЕРЕНО** (в договоре не подтверждается). Тарифы ([pricing](https://www.geoapify.com/pricing/)):
Free 3,000 credits/day @5 req/s, «Limited Commercial Use»; API 10 — $59/мес, 10,000 credits/day @12 req/s.

**Photon** ([photon.komoot.io](https://photon.komoot.io/)): вся политика публичного инстанса — «please be fair -
extensive usage will be throttled» и «We do not guarantee for the availability». Про хранение, лицензию и
self-hosting на странице сервиса ничего — **НЕ ПРОВЕРЕНО**.

#### Сводная таблица

| Провайдер | Постоянное хранение lat/lng у себя? | Лимиты | Цена | Атрибуция |
|---|---|---|---|---|
| Nominatim (публичный) | **Требуется** политикой | **1 req/s** абсолютный максимум; bulk/systematic запрещены; обязателен UA/Referer | $0 | OSM + ODbL |
| **Nominatim (self-hosted)** | Да, без ограничений | Только железо; экстракт страны реалистичен | стоимость VM | OSM + ODbL |
| Google Geocoding | **Нет** — 30 дней (§6.3.1); бессрочно только с изоляцией per-End-User | + запрет не-Google-карты (§6.2) и «listings or directory service» (§3.2.3(d)) | 10k/мес free, далее $5.00/1,000 | по документации |
| Mapbox Temporary | Нет | 100k/мес бесплатно | $0.75/1,000 далее | Mapbox + OSM |
| Mapbox Permanent | **Да**, без «distribution or sublicense» | доступ через sales | **$5.00/1,000**, free-тира нет | Mapbox + OSM |
| **MapTiler** | **Да** — «allowed for usage outside of the Service»; bulk geocoding разрешён | квоты по тарифам **НЕ ПРОВЕРЕНО** | Free (non-commercial) / **$30/мес** | атрибуция в самой базе или в файле рядом |
| LocationIQ | **Да**, пока активна подписка (free — 48 ч) | 5k/day @2 r/s → 25k/day @20 r/s | $0 / $100 / $200 / $500 / $950 | OSM |
| Geoapify | Заявлено, но **НЕ ПРОВЕРЕНО** в Terms | 3k credits/day @5 r/s | $0 / $59/мес | OSM всегда, Geoapify на free |
| Photon (публичный) | **НЕ ПРОВЕРЕНО** | «please be fair» | $0 | **НЕ ПРОВЕРЕНО** |

**Рекомендация из текстов условий:** основной путь — **self-hosted Nominatim на экстракте Грузии** (бесплатно, без
чужих ToS и лимитов); управляемая альтернатива — **MapTiler Flex $30/мес** (единственный хостед-вариант с явным
письменным разрешением на использование результатов вне сервиса); LocationIQ — если понадобится пропускная
способность. Google — исключён.

#### Покрытие Грузии

Google публикует country-level таблицу ([coverage](https://developers.google.com/maps/coverage)) и ставит
**Georgia (GE) — ⬤ для Geocoding** («The feature is available in the area, with good data quality and availability»).
Это единственное первичное утверждение о качестве геокодинга по Грузии, которое удалось найти, — и оно относится
к провайдеру, который нам контрактно недоступен.

**Ни OSMF, ни Nominatim, ни Mapbox, ни MapTiler, ни LocationIQ, ни Geoapify не публикуют утверждений о качестве
покрытия Грузии, Тбилиси или Батуми — НЕ ПРОВЕРЕНО.** Устанавливается только замером на выборке реальных адресов
площадок (см. раздел про пилот).

### 4.4 PostgreSQL + PostGIS

Все функции подтверждены по [postgis.net/docs](https://postgis.net/docs/).

**Радиусный поиск.** `ST_DWithin(geography, geography, distance_meters, use_spheroid = true)` — geography-вариант
принимает **метры** напрямую. Документация: «This function call includes a bounding box comparison that makes use
of any indexes that are available on the geometries». Availability: geometry — до 1.3, geography — 1.5.0,
ускорение geography — 2.1.0 ([ST_DWithin](https://postgis.net/docs/ST_DWithin.html)). Тип `geography` —
«a spatial data type used to represent a feature in geodetic coordinate systems», даёт «more accurate results»
([geography](https://postgis.net/docs/geography.html)). Для широт Грузии (~41–43°N) geography — правильный выбор.

**«Искать в этой области» (bbox).** `ST_MakeEnvelope(xmin, ymin, xmax, ymax, srid)` — «Creates a rectangular Polygon
from the minimum and maximum values for X and Y», availability 1.5, SRID-параметр с 2.0
([ST_MakeEnvelope](https://postgis.net/docs/ST_MakeEnvelope.html)). Оператор `&&` — пересечение bounding box,
поддерживается всеми тремя типами индексов как primary filter
([dbmanagement](https://postgis.net/docs/using_postgis_dbmanagement.html)).
Паттерн: `WHERE geom && ST_MakeEnvelope(minx, miny, maxx, maxy, 4326)`.

**Индексы.** GiST — «the most commonly-used and versatile spatial index method, and offers very good query
performance»; синтаксис `CREATE INDEX … USING GIST (geomfield)`. SP-GiST — «an alternative to GiST indexes»
(quad-tree, k-d tree). BRIN — «much faster index create time, and much smaller index size», но «typically less
performant for read» ([dbmanagement](https://postgis.net/docs/using_postgis_dbmanagement.html)).
Для часто обновляемой таблицы событий — **GiST**.

**Серверная кластеризация.**
`ST_ClusterDBSCAN(geometry winset, eps, minpoints) → integer` — оконная функция, возвращает номер кластера,
шум получает NULL; availability **2.3.0** ([docs](https://postgis.net/docs/ST_ClusterDBSCAN.html)).
`ST_ClusterKMeans(geometry winset, k, max_radius)` — availability 2.3.0, параметр `max_radius` добавлен в **3.2.0**
и «will cause ST_ClusterKMeans to generate more clusters than k ensuring that no cluster in output has radius larger
than max_radius» ([docs](https://postgis.net/docs/ST_ClusterKMeans.html)) — именно то, что нужно для зависимой от
зума кластеризации. **Минимальная версия PostGIS для полного набора — 3.2.**

**Векторные тайлы, если клиентской кластеризации перестанет хватать:**
`ST_TileEnvelope(z, x, y, bounds, margin)` (availability 3.0.0, `margin` — 3.1.0,
[docs](https://postgis.net/docs/ST_TileEnvelope.html)) → `ST_AsMVTGeom` → `ST_AsMVT` (extent по умолчанию 4096,
availability 2.4.0, параллельные запросы с 2.5.0, [docs](https://postgis.net/docs/manual-3.5/ST_AsMVT.html)).

**Вердикт:** все три требуемые возможности подтверждены штатными функциями PostGIS ≥ 3.2. Отдельного
геопоискового движка не нужно.

### 4.5 Очереди задач

| | Redis? | Cron | Retry + backoff | Concurrency / rate limit | Хостинг |
|---|---|---|---|---|---|
| [pg-boss](https://pgboss.io/) | Нет | Да | Да, экспоненциальный | Queue storage policies | Self, MIT |
| [Graphile Worker](https://worker.graphile.org/docs) | Нет | Да (+ backfill) | Да, 25 попыток / ~3 дня | Именованные очереди сериализуют | Self, MIT |
| [BullMQ](https://docs.bullmq.io/) | **Да** | Да | Да | Per-worker + глобальный rate limit | Self MIT + платный Pro |
| [Inngest](https://www.inngest.com/pricing) | n/a | Да | Да | Free: **5 concurrent steps** | SaaS + self-host |
| [Trigger.dev](https://trigger.dev/pricing) | n/a | Да | Да | Free: 20 concurrent runs | SaaS + self-host, Apache 2.0 |

**pg-boss** — чистый Postgres, `SKIP LOCKED` для «exactly-once job delivery» + LISTEN/NOTIFY; «Cron scheduling,
job deferral»; «automatic retries with exponential backoff»; «Queue storage policies to support a variety of rate
limiting, debouncing, and concurrency use cases»; dead-letter queues с redrive; транзакционное создание задач через
адаптеры Drizzle / Knex / Kysely / Prisma. Требования: **Node 22.12+, PostgreSQL 13+**
([pgboss.io](https://pgboss.io/), [GitHub](https://github.com/timgit/pg-boss)).

**Graphile Worker** — «Crontab-like scheduling feature for recurring tasks (with optional backfill)»,
«Automatically re-attempts failed jobs with exponential back-off», «Customizable retry count (default: 25 attempts
over ~3 days)». Параллелизм по умолчанию, но «Adding jobs to same named queue runs them in series». Rate limiting —
внешним плагином ([docs](https://worker.graphile.org/docs), [GitHub](https://github.com/graphile/worker)).
Минимальная версия PostgreSQL на прочитанных страницах не указана — **НЕ ПРОВЕРЕНО**.

**BullMQ** — «a fast and robust queue system built on top of Redis», то есть добавляет Redis в стек, которого
иначе нет. В доках появился раздел про PostgreSQL backend — его зрелость **НЕ ПРОВЕРЕНО**.

**Inngest / Trigger.dev** — SaaS с потолками по конкурентности на бесплатных тарифах (5 и 20 соответственно),
для скрейпингового пайплайна тесновато; Trigger.dev дополнительно тарифицирует compute посекундно плюс
$0.25 за 10,000 runs.

**Рекомендация:** **pg-boss** — Postgres уже есть, Redis не нужен, есть cron, backoff, dead-letter и политики
очередей под rate-limiting по источникам. Graphile Worker — равнозначная альтернатива, если политики не нужны.

---

## 5. Telegram Mini App

**Способы запуска и `initData`** ([Mini Apps](https://core.telegram.org/bots/webapps)):

| Запуск | Отдаёт `initData`? |
|---|---|
| Keyboard button (`web_app` KeyboardButton) | **Нет** — только `Telegram.WebApp.sendData` |
| Inline button | Да |
| Menu button | Да |
| Main Mini App (`t.me/bot?startapp`) | Да, + `start_param` |
| **Direct link (`t.me/bot/appname`)** | Да, + `start_param` |
| Attachment menu / chat join request | Да |

Для нашего сценария (переход с SEO-сайта в Mini App на конкретное событие) правильный путь —
**Direct Link Mini App**: `t.me/<bot>/<app>?startapp=<eventId>`. Документация: «If a non-empty startapp parameter is
included in the link, it will be passed to the Mini App in the start_param field and in the GET parameter
tgWebAppStartParam». Ограничение параметра: «up to 64 base64url characters» ([links](https://core.telegram.org/api/links)),
допустимые символы `A-Z, a-z, 0-9, _, -` ([deep linking](https://core.telegram.org/bots/features#deep-linking)).
Keyboard-button запуска нужно избегать — там нет авторизации.

**Валидация `initData`.** Классический способ — HMAC-SHA-256: `secret_key = HMAC_SHA256(<bot_token>, "WebAppData")`,
затем сравнение с `hash` ([docs](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app)).
Поля: `query_id`, `user`, `receiver`, `chat`, `chat_type`, `chat_instance`, `start_param`, `can_send_after`,
`auth_date`, `hash`, `signature`. Telegram советует «check the auth_date field», но **конкретного TTL не задаёт** —
выбор окна на нас.

С **Bot API 8.0 (17.11.2024)** появилась валидация третьей стороной по Ed25519 через поле `signature`, без знания
токена бота; data-check-string начинается с `<bot_id>:WebAppData\n`, публичные ключи опубликованы на той же странице
([docs](https://core.telegram.org/bots/webapps#validating-data-for-third-party-use),
[changelog](https://core.telegram.org/bots/api-changelog)). Полезно, если общий бэкенд захочется разнести на сервисы,
не раздавая токен.

**Карта внутри Mini App — главный UX-риск и его решение.** Вертикальный свайп закрывает Mini App и конфликтует
с драгом карты. С **Bot API 7.7+** есть `disableVerticalSwipes()`: «disables vertical swipes to close or minimize
the Mini App. This method is useful if your Mini App uses swipe gestures that may conflict with the gestures for
minimizing and closing the app»; рекомендация — «always enable swipes unless they conflict». Также доступны
`viewportHeight` / `viewportStableHeight` (и CSS-переменные `--tg-viewport-height`, `--tg-viewport-stable-height`),
`expand()`, `isExpanded`. С **8.0** — `requestFullscreen()` / `exitFullscreen()`, `safeAreaInset`,
`contentSafeAreaInset` ([Mini Apps](https://core.telegram.org/bots/webapps),
[блог 17.11.2024](https://telegram.org/blog/fullscreen-miniapps-and-more)).

**Геолокация:** `LocationManager` с `init()`, `getLocation()`, `openSettings()` — **Bot API 8.0+**, и доступ
по умолчанию выключен. Значит для сайта и старых клиентов нужен fallback на `navigator.geolocation`.

**CTA «написать организатору»:** `Telegram.WebApp.openTelegramLink('https://t.me/<username>')` — «The Mini App will
not be closed after this method is called. Up to Bot API 7.0 The Mini App will be closed after this method is called».
Прямая ссылка на профиль — `t.me/<username>` или `tg://user?id=<id>` ([links](https://core.telegram.org/api/links)),
но принимает ли `openTelegramLink` схему `tg://` — **НЕ ПРОВЕРЕНО**. Практический вывод: у организаторов должен быть
публичный username.

**Общий бэкенд с сайтом.** Mini App — это обычный WebView, загружающий наш origin, поэтому CORS становится проблемой
только при разнесении API на другой хост; общей CORS-политики Telegram не документирует (единственное упоминание
`Access-Control-Allow-Origin: https://web.telegram.org` относится к скачиванию файлов). Требование HTTPS во всех
примерах присутствует, но формулировку в `WebAppInfo.url` вычитать не удалось — **НЕ ПРОВЕРЕНО**.
Кеширование WebView **не документировано вообще** — **НЕ ПРОВЕРЕНО**, закладывать хешированные имена ассетов.
`sendData` (keyboard-button) для нас непригоден: документация прямо предупреждает «Be aware that a bad client can
send arbitrary data in this field» — это не замена REST-бэкенду с авторизацией по `initData`.

**Discovery.** Каталог существует: «Bots that enabled a main mini app will be displayed in the Apps tab of the search
for users who have launched them» и «Successful bots which enable a main Mini App and accept payments in Telegram
Stars may be featured in the Telegram Mini App Store» ([Mini Apps](https://core.telegram.org/bots/webapps));
на уровне MTProto — [bots.getPopularAppBots](https://core.telegram.org/method/bots.getPopularAppBots),
«to be used in the apps tab of global search». **Алгоритм ранжирования Telegram не документирует нигде.**
Названы лишь рычаги: Main Mini App, приём Telegram Stars, качественные медиа в профиле, следование гайдлайнам.
Для локального грузинского продукта Apps tab — канал удержания, а не привлечения.

**Лимиты хранилища Mini App**: CloudStorage «up to 1024 items per user», DeviceStorage «up to 5 MB per user»,
SecureStorage «up to 10 items per user». Ограничений на размер бандла или производительность **не документировано** —
**НЕ ПРОВЕРЕНО**; при этом MapLibre GL JS — тяжёлый бандл, и холодный старт в мобильном WebView надо мерить.

---

## 6. SEO и структурированные данные

Все утверждения — по документации Google Search Central.

### 6.1 Event structured data: обязательное и рекомендуемое

[Event structured data](https://developers.google.com/search/docs/appearance/structured-data/event).
**Обязательных свойств всего четыре:**

| Свойство | Тип | Формулировка документации |
|---|---|---|
| `location` | Place | «The location of the event. Set the `@type` to `Place`. Add the `location.address` and `location.name` properties.» |
| `location.address` | PostalAddress | «The venue's detailed street address.» Not recommended: `Sydney`. Recommended: `Bennelong Point, Sydney NSW 2000, Australia` |
| `name` | Text | «The full title of the event. **DO NOT put the name of the event location.**» |
| `startDate` | DateTime | «The start date and start time of the event in ISO-8601 format.» |

**Рекомендуемые:** `description`, `endDate`, `eventStatus`, `image`, `location.name`, `offers`, `offers.availability`,
`offers.price`, `offers.priceCurrency`, `offers.validFrom`, `offers.url`, `organizer`, `organizer.name`,
`organizer.url`, `performer`, `performer.name`, `previousStartDate`.

**Онлайн-события больше не поддерживаются.** В текущих нормативных таблицах нет ни `VirtualLocation`, ни `location.url`,
ни `eventAttendanceMode`. Content guidelines: «Virtual experiences that have no real-world component aren't supported.
Events must take place in a physical location.» Это изменение зафиксировано в
[changelog 5 июня 2025](https://developers.google.com/search/updates): «Also removed the online event properties».
Для нашего V1 это не проблема — офлайн-события и так основной формат.

### 6.2 `offers` — свойство, которое агрегатору проще не заполнять

`offers` **не обязательно**. Если заполнять:
- `offers.price` — «The lowest available price available for your tickets, including service charges and fees…
  If the event is available without payment, fees, or service charges, **set the price to `0`**».
- `offers.priceCurrency` — «The 3-letter ISO 4217 currency code», то есть `GEL`.
- `offers.availability` — `InStock` / `SoldOut` / `PreOrder`.
- `offers.url` — три жёстких требования: «Direct to a landing page that clearly and predominantly provides the
  opportunity to **buy a ticket** offering admittance to that specific event to any user from the general public»;
  «Be a link that a user could click the web page that contains the event»; «Be crawlable by Googlebot».

**Прямое следствие:** пост в Instagram или сообщение в Telegram — это не страница покупки билета. Ставить туда
`offers.url` — нарушение первого требования. Для событий без настоящего ticketing-URL блок `offers` надо
**опускать целиком**, а не подставлять ссылку на источник.

### 6.3 Даты — и правило, критичное для LLM-извлечения

«Specify the timezone by including the UTC or GMT time offset». Грузия — UTC+4 круглый год, то есть
`2026-09-20T19:00:00+04:00`. Fallback: «If no timezone is provided, Google uses the timezone of the event's location».

Best practices, дословно:
- Многодневное: `"startDate": "2019-07-01", "endDate": "2019-07-26"` — Recommended;
  вариант с `T00:00:00+00:00` … `T23:59:59+00:00` — **Not recommended**.
- Событие на весь день: «don't specify a granular hour… you can use `2019-08-15` as both the `startDate` and `endDate`».
- **«If you don't know the hour for the start time, don't specify a granular hour.»** Recommended: `"2025-07-21"`.
  Not recommended: `"2019-08-15T00:00:00+00:00"`.

Последнее — прямое требование к нашему экстрактору: **никогда не подставлять полночь вместо неизвестного времени**.

Отмены и переносы: `eventStatus` принимает `EventScheduled` (по умолчанию), `EventCancelled`, `EventPostponed`,
`EventRescheduled`. Явное предупреждение: «When the event status changes, **DON'T remove the `startDate`**»;
при переносе «Keep the original date in the `startDate` … until you know when the event will take place».
Для машинно-собранного каталога это значит: при обнаружении отмены надо менять `eventStatus`, а не удалять страницу.

### 6.4 Пригодность агрегатора и правило «одна страница — одно событие»

Документация прямо адресует наш кейс во вступлении: «If you use a third-party website to post events (for example,
you post events on ticketing websites or social platforms), check to see if your event publisher is already
participating in the event search experience on Google.»

**Запрета на использование Event-разметки агрегаторами и требования владеть событием в документации нет.**
Ограничения структурные, из Technical guidelines:
- «Each event MUST have a unique URL (a leaf page) and markup on that URL.»
- «The event experience on Google **only supports pages that focus on a single event**. We recommend focusing on
  adding markup to your event posting pages instead of pages that list schedules or multiple events.»

**Архитектурное следствие:** `Event`-разметку ставить только на страницы отдельных событий. Городские и тематические
листинги и карта — **без** `Event`, максимум `ItemList` / `BreadcrumbList`. SEO-ценность city/topic-страниц должна
идти от структуры обхода и содержательного контента, а не от rich results.

Content guidelines, дословно:
- «Each event must accurately describe the event name, start date, and location.»
- «Events must be bookable to the general public. Events that require a membership, or invitation prior to purchasing
  the ticket or attending the event are ineligible.» ← это может выбить часть ретритов и закрытых практик.
- Не размечать: турпакеты, краткосрочные скидки, часы работы заведения, купоны.
- Предупреждение: «If your site violates one or more of these guidelines, then Google may take manual action against it.»

### 6.5 Общие политики структурированных данных

[Structured data general guidelines](https://developers.google.com/search/docs/appearance/structured-data/sd-policies):

- «Provide **up-to-date** information. We won't show a rich result for time-sensitive content that is no longer
  relevant.» — прошедшие события в индексе прямо вредят.
- «Provide **original content that you or your users have generated**.» — самая острая точка трения с нашим пайплайном.
- «**Don't mark up content that is not visible to readers of the page.**» — каждое поле JSON-LD обязано быть
  отрисовано на странице. Если LLM вывел адрес, которого нет в видимом тексте, это нарушение.
- «Don't use structured data to deceive or mislead users. **Don't impersonate any person or organization, or
  misrepresent your ownership, affiliation, or primary purpose.**» — надо явно позиционироваться как агрегатор.
- Completeness: «Items that are missing required properties are not eligible for rich results. The more recommended
  properties that you provide, the higher quality the result is to users… Rich result ranking takes extra
  information into consideration.»
- Access: «Don't block your structured data pages to Googlebot using robots.txt, `noindex`, or any other access
  control methods.»
- Смягчающее: «A structured data manual action means that a page loses eligibility for appearance as a rich result;
  **it doesn't affect how the page ranks in Google web search**.»

### 6.6 Spam policies: главный SEO-риск машинного каталога

[Spam policies](https://developers.google.com/search/docs/essentials/spam-policies).

**Scraped content**, определение: «taking content from other sites, often through automated means, and hosting it
**with the purpose of manipulating search rankings**». Примеры злоупотребления:
- «Republishing content from other sites **without adding any original content or value, or even citing the original source**»
- «Copying content from other sites, modify it only slightly (for example, by substituting synonyms or **using automated techniques**), and republish it»
- «Creating sites dedicated to embedding or compiling content … from other sites, **without substantial added value to the user**»

**Scaled content abuse**: «when many pages are generated for the primary purpose of manipulating search rankings and
not helping users… **no matter how it's created**». Примеры включают «Using generative AI tools … to generate many
pages without adding value for users» и «**Scraping feeds, search results, or other content to generate many pages**
(including through automated transformations like synonymizing, translating, or other obfuscation techniques), where
little value is provided to users».

**Нюанс, который делает проект защитимым:** каждое определение квалифицировано намерением и добавленной ценностью —
«with the purpose of manipulating search rankings», «without adding any original content or value», «where little
value is provided». Агрегация как таковая не запрещена. Наша защитимая позиция — сама нормализация: разрозненные
анонсы из Instagram и Telegram превращаются в единый ищущийся, геокодированный, фильтруемый каталог по Грузии,
чего не даёт ни один отдельный источник.

Что переведёт нас на неправильную сторону: дословная перепубликация caption, машинно-переведённые почти-дубликаты,
генерация страниц-перестановок «город × тема × дата» без собственного содержания, отсутствие ссылки на первоисточник.
Отдельно стоит держать в голове формулировку из thin affiliation: «cookie-cutter sites or templates with the same
or similar content replicated within the same site or across multiple domains or languages» — это буквальное
предупреждение против программной генерации city/topic-лендингов.

### 6.7 События без точного адреса

Ответ есть прямо в блоке *Best practices for addresses*:
- «If the event happens across several streets, define the starting location and mention the full details in `description`.»
- «**If the event happens without a well-defined location, use the city name or the most representative location.**»
- «If the event happens at multiple locations at the same time, create different events for each location.»

Сигнал качества — специфичность: «Not recommended: `Sydney`. Recommended: `Bennelong Point, Sydney NSW 2000, Australia`».
**Минимальной гранулярности, которая дисквалифицирует событие, не установлено** — город явно назван допустимым
запасным вариантом. Для `location.name` своё правило: «Don't include a city name unless it is a city-wide event» и
«If you don't know the name of the location, don't use this property».

**Правило для пайплайна:** название площадки + улица, когда экстрактор уверен; название площадки +
`addressLocality: Tbilisi` + `addressCountry: GE`, когда известна только площадка; только город — как нижняя граница.
`location`/`location.address` не опускать никогда (обязательны) и **не выдумывать улицу** — это одновременно нарушение
«true representation» и «don't mark up content that is not visible to readers».

### 6.8 Изменения rich results

[Search Central updates](https://developers.google.com/search/updates), обновлено 2026-08-31:
единственное изменение по Event — **5 июня 2025**, «Updating our guidance for event structured data»: добавлены
примеры пригодных/непригодных событий и «removed the online event properties», потому что «events must be bookable
by the general public and held at a physical location». Далее в 2025 и в 2026 изменений по Event нет.
**Event rich result не удалён и не помечен как deprecated.**

---

## 7. Стоимость LLM-извлечения

Все цены — first-party ([claude.com/pricing](https://claude.com/pricing), справочник моделей Claude API).

**Модели и цены за 1M токенов:**

| Модель | Input | Output |
|---|---|---|
| Claude Opus 5 (`claude-opus-5`) | $5.00 | $25.00 |
| Claude Sonnet 5 (`claude-sonnet-5`) | $2.00 | $10.00 |
| Claude Haiku 4.5 (`claude-haiku-4-5`) | $1.00 | $5.00 |

**Как считаются изображения.** «Claude views images in patches instead of pixels. Each patch is a 28×28-pixel block
of the image, referred to as a visual token. An image, therefore, costs `⌈width / 28⌉ × ⌈height / 28⌉` visual tokens»
([Vision](https://platform.claude.com/docs/en/build-with-claude/vision)). Есть два уровня разрешения:
standard (max long edge 1568 px, max 1568 visual tokens) и high-resolution для Claude 4.7 и новее
(2576 px, 4784 tokens). Табличные значения из доков:

| Размер постера | Standard tier | High-resolution tier |
|---|---|---|
| 1000×1000 px | 1296 tokens | 1296 tokens |
| 1080×1080 px (типичный IG-пост) | ~1521 tokens | ~1521 tokens |
| 1920×1080 px | 1560 tokens | 2691 tokens |

Документация даёт готовый ориентир: «At Claude Haiku 4.5's $1 USD per million input tokens (standard tier),
the 1000×1000 image costs about $1.30 USD per thousand images».

**Скидки.** Message Batches — 50 % от цены (подходит идеально: ингест не latency-sensitive).
Prompt caching: запись ~1.25× базовой цены input при 5-минутном TTL, чтение ~0.1×
— системный промпт + схема извлечения кешируются и почти не стоят.

**Модель одного события (допущения явно):**

- вход: системный промпт + схема ~1,200 токенов (кешируется), caption поста ~400 токенов,
  постер 1080×1080 ≈ 1,521 visual tokens → **≈ 3,100 input-токенов**, из них ~1,200 из кеша;
- выход: структурированная карточка ~350 output-токенов;
- модель: Claude Haiku 4.5 (задача — извлечение по схеме, не рассуждение).

Стоимость одного события, Haiku 4.5, без batch:
`(1,900 × $1 + 1,200 × $0.10 + 350 × $5) / 1,000,000` ≈ **$0.0038** ≈ 0.4 цента.
С Batch API (−50 %) — **≈ $0.0019**.
На Claude Sonnet 5 без batch — примерно **$0.0073**; на Opus 5 — примерно **$0.018**.

**Помесячно.** Ключевое: LLM гоняется по всем *кандидатам*, а не только по опубликованным событиям.
При 40 профилях × 5 новых постов/день = 6,000 кандидатов/мес:

| Модель | Без batch | С Batch API |
|---|---|---|
| Haiku 4.5 | ~$23/мес | ~$11/мес |
| Sonnet 5 | ~$44/мес | ~$22/мес |
| Opus 5 | ~$108/мес | ~$54/мес |

При 14,400 кандидатах/мес (12 постов/профиль) цифры умножаются на 2.4: Haiku ~$55/мес без batch, ~$27 с batch.

**Вывод:** стоимость AI-пайплайна на порядок ниже, чем предполагает интуиция, и в разы меньше, чем стоимость одного
часа ручной модерации. Оптимизировать надо не цену токена, а **точность извлечения** — единственный способ обойтись
без ручной проверки каждой карточки. Практический совет из доков, влияющий на качество: изображения лучше ставить
**перед** текстом («Claude works best when images come before text») и не пережимать постеры («heavy JPEG compression
can make text difficult to read») — а именно текст на постере и несёт дату/цену/адрес.

---

## Риски и что решается только пилотом

### Блокирующие риски (решаются не пилотом, а решением о продукте)

1. **Telegram-каналы как источник.** Три документа Telegram запрещают ровно нашу схему (§1.2). Это не риск
   производительности, это выбор: либо отказ от источника, либо онбординг организаторов с явным согласием,
   либо осознанное нарушение ToS с риском бана аккаунта/приложения.
2. **Instagram-скрейпинг.** Нарушение Meta ToS явным текстом (§1.1), при том что вендоры контрактно
   перекладывают ответственность на нас. Официальные альтернативы (Business Discovery) требуют App Review +
   Business Verification и не покрывают Stories.
3. **Юридическая экспертиза.** Вопросы применимого права, GDPR-оснований обработки (caption + username =
   персональные данные), и правомерности переиспользования постеров — **вне моей компетенции**, нужен юрист
   с грузинской и, вероятно, европейской специализацией.

### Что можно установить только пилотом

| Что мерить | Почему нельзя узнать из документации | Как мерить |
|---|---|---|
| **Время жизни Instagram CDN-ссылок** | Ни Apify, ни Bright Data этого не документируют | Сохранить 50 `displayUrl`, дёргать раз в час, зафиксировать момент 403 |
| **Реально ли `latestPosts` даёт 12 постов с нужными полями** | Актор-страница заявляет, схему вложенных полей не публикует | Один прогон `instagram-profile-scraper` на 5 профилях, diff полей против `instagram-scraper` |
| **Фактическая стоимость при `onlyPostsNewerThan`** | Зависит от реальной частоты постинга организаторов | Неделя ежедневных прогонов, сравнить счёт с расчётом §2.3 |
| **Точность LLM-извлечения** | Никакой источник этого не предскажет | 200 реальных постов → золотой набор вручную → precision/recall по полям: дата, время, адрес, цена, тема; отдельно доля «recap vs upcoming» ошибок и доля постов с несколькими событиями |
| **Доля постов, где дата/адрес есть только на картинке** | Определяет, нужен ли vision вообще и какой tier разрешения | Разметить те же 200 постов |
| **Качество OSM-геокодинга для Тбилиси и Батуми** | First-party заявлений о покрытии Грузии нет ни у кого | 100 реальных адресов площадок → сравнить провайдеров по доле точных попаданий |
| **Покрытие грузинских названий в тайлах (`name:ka`/`name:en`)** | Не документировано ни одним провайдером | Визуальная проверка Тбилиси/Батуми/Казбеги в MapTiler, OpenFreeMap и своём PMTiles-экстракте |
| **Размер PMTiles-экстракта Грузии** | First-party цифр нет | Один прогон `pmtiles extract --bbox` |
| **Флуд-лимиты Telegram (если источник вообще останется)** | Telegram не публикует числа, только `FLOOD_WAIT_%d` | Только эмпирически — и только если решён вопрос §1.2 |
| **Холодный старт MapLibre в Telegram WebView** | Лимитов и характеристик Telegram не публикует | Замер TTI на среднем Android в Mini App vs браузер |
| **Кеширование бандла Telegram WebView** | Не документировано вообще | Деплой с изменённым хешем ассета, проверка, подхватился ли |
| **Принимает ли `openTelegramLink` схему `tg://user?id=`** | Нет в доках | Проверка на устройстве |
| **Индексируется ли каталог Google без пометки «scraped content»** | Политики есть, применение — нет | Опубликовать 50 страниц, следить за индексацией и rich results в Search Console 4–6 недель |

---

## Источники

Дата обращения ко всем ссылкам — **2026-09-07**.

### Meta / Instagram
- https://www.facebook.com/terms.php — Meta Terms of Service
- https://www.facebook.com/legal/automated_data_collection_terms — Automated Data Collection Terms
- https://help.instagram.com/581066165581870/ — Instagram Terms of Use
- https://developers.facebook.com/blog/post/2024/09/04/update-on-instagram-basic-display-api/ — отключение Basic Display API
- https://developers.facebook.com/docs/instagram-platform/ — Instagram Platform
- https://developers.facebook.com/docs/instagram-platform/overview/ — App Review, Advanced Access, Business Verification
- https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/business_discovery/ — Business Discovery
- https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-hashtag-search/ — Hashtag Search
- https://developers.facebook.com/docs/instagram-platform/oembed/ — Instagram oEmbed
- https://developers.facebook.com/docs/instagram-platform/insights/ — Insights (Stories)

### Telegram
- https://telegram.org/tos — Terms of Service
- https://telegram.org/tos/content-licensing — Terms of Service for Content Licensing (AI/scraping)
- https://telegram.org/tos/bot-developers — Terms of Service for Bot Developers
- https://core.telegram.org/api/terms — Telegram API Terms of Service
- https://core.telegram.org/api/errors — Error handling (FLOOD_WAIT)
- https://core.telegram.org/api/updates — Updates, pts, getChannelDifference
- https://core.telegram.org/bots/faq — Bots FAQ (видимость сообщений, лимиты отправки)
- https://core.telegram.org/bots/webapps — Mini Apps
- https://core.telegram.org/bots/features#deep-linking — Deep linking
- https://core.telegram.org/api/links — t.me link formats
- https://core.telegram.org/bots/api-changelog — Bot API changelog
- https://core.telegram.org/method/bots.getPopularAppBots — Apps tab
- https://telegram.org/blog/fullscreen-miniapps-and-more — Mini Apps 2.0 (17.11.2024)

### Право
- https://matsne.gov.ge/en/document/view/16198 — Закон Грузии об авторском праве и смежных правах
- https://www.wipo.int/wipolex/en/legislation/details/22704 — WIPO Lex, тот же закон
- https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32019L0790 — Directive (EU) 2019/790 (TDM, Art. 3–4, 15)
- https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A31996L0009 — Directive 96/9/EC (database rights)

### Вендоры скрейпинга
- https://apify.com/pricing — тарифы Apify
- https://docs.apify.com/platform/limits — лимиты платформы
- https://docs.apify.com/platform/actors/publishing/monetize — модель pay-per-event
- https://apify.com/apify/instagram-scraper — актор, цены, поля
- https://apify.com/apify/instagram-scraper/api — цены за 1k результатов
- https://apify.com/apify/instagram-scraper/input-schema — `onlyPostsNewerThan`
- https://apify.com/apify/instagram-post-scraper
- https://apify.com/apify/instagram-profile-scraper — `latestPosts`
- https://docs.apify.com/legal/general-terms-and-conditions
- https://docs.apify.com/legal/acceptable-use-policy
- https://brightdata.com/pricing/web-scraper — цены
- https://brightdata.com/products/web-scraper/instagram — продукт
- https://brightdata.com/products/web-scraper/instagram/posts — поля
- https://docs.brightdata.com/products/scrapers/instagram/introduction — API
- https://brightdata.com/acceptable-use-policy
- https://brightdata.com/license — MSA, KYC
- https://brightdata.com/legal

### Стек
- https://tanstack.com/start/latest/docs/framework/react/overview — статус RC
- https://tanstack.com/start/latest/docs/framework/react/guide/selective-ssr
- https://tanstack.com/start/latest/docs/framework/react/guide/server-functions
- https://tanstack.com/start/latest/docs/framework/react/guide/server-routes
- https://tanstack.com/start/latest/docs/framework/react/guide/hosting
- https://tanstack.com/start/latest/docs/framework/react/guide/isr
- https://tanstack.com/router/latest/docs/framework/react/guide/document-head-management — head, JSON-LD
- https://registry.npmjs.org/@tanstack/react-start/latest — версия
- https://github.com/TanStack/router/releases
- https://github.com/maplibre/maplibre-gl-js/releases — версия MapLibre
- https://maplibre.org/maplibre-style-spec/sources/ — параметры кластеризации
- https://maplibre.org/maplibre-gl-js/docs/API/classes/GeoJSONSource/ — cluster API
- https://maplibre.org/maplibre-gl-js/docs/guides/large-data/
- https://www.maptiler.com/cloud/pricing/ · https://www.maptiler.com/terms/
- https://openfreemap.org/ · https://github.com/hyperknot/openfreemap
- https://docs.protomaps.com/ · https://docs.protomaps.com/basemaps/downloads · https://docs.protomaps.com/basemaps/maplibre · https://docs.protomaps.com/pmtiles/cli · https://docs.protomaps.com/deploy/
- https://stadiamaps.com/pricing/
- https://postgis.net/docs/ST_DWithin.html · https://postgis.net/docs/geography.html · https://postgis.net/docs/ST_MakeEnvelope.html · https://postgis.net/docs/using_postgis_dbmanagement.html · https://postgis.net/docs/ST_ClusterDBSCAN.html · https://postgis.net/docs/ST_ClusterKMeans.html · https://postgis.net/docs/manual-3.5/ST_AsMVT.html · https://postgis.net/docs/ST_TileEnvelope.html
- https://pgboss.io/ · https://github.com/timgit/pg-boss
- https://worker.graphile.org/docs · https://github.com/graphile/worker
- https://docs.bullmq.io/
- https://www.inngest.com/pricing
- https://trigger.dev/pricing

### Геокодинг
- https://operations.osmfoundation.org/policies/nominatim/ — Nominatim Usage Policy
- https://nominatim.org/release-docs/latest/admin/Installation/ — требования к железу
- https://nominatim.org/release-docs/latest/admin/Import/ — импорт по экстракту страны
- https://www.openstreetmap.org/copyright — ODbL, атрибуция
- https://cloud.google.com/maps-platform/terms/ — Google Maps Platform ToS (§3.2.3)
- https://cloud.google.com/maps-platform/terms/maps-service-terms — Maps Service Specific Terms (§6 Geocoding)
- https://developers.google.com/maps/billing-and-pricing/pricing — цены Geocoding API
- https://developers.google.com/maps/coverage — покрытие по странам
- https://www.mapbox.com/pricing — Permanent / Temporary Geocoding
- https://www.mapbox.com/legal/tos — Mapbox ToS
- https://www.maptiler.com/terms/cloud/ — разрешение на использование результатов вне сервиса
- https://locationiq.com/pricing · https://help.locationiq.com/support/solutions/articles/36000216111-can-i-save-addresses-from-api-output- · https://help.locationiq.com/support/solutions/articles/36000216698-can-i-cache-the-results-
- https://www.geoapify.com/terms-and-conditions/ · https://www.geoapify.com/pricing/
- https://photon.komoot.io/

### SEO
- https://developers.google.com/search/docs/appearance/structured-data/event — Event structured data
- https://developers.google.com/search/docs/appearance/structured-data/sd-policies — общие требования к разметке
- https://developers.google.com/search/docs/essentials/spam-policies — scraped content, scaled content abuse
- https://developers.google.com/search/updates — changelog (5 июня 2025: удаление online event properties)

### AI
- https://claude.com/pricing — цены на модели
- https://platform.claude.com/docs/en/build-with-claude/vision — visual tokens, формула, лимиты изображений
