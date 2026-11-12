---
name: event-cover
description: Как одним вызовом image_generate сделать обложку события 9:16 — чистую живую фотографию во весь кадр, без текста и без графики. Загружай первым на каждое задание.
---

# Обложка события

Обложка — **чистая живая фотография во весь кадр**: без текста и без графических слоёв. Человек, место и предметы — как у организатора. Знак «Я с вами» на обложку ставит сама страница, рисовать его не нужно.

Данные события: `title`, `description`, `topic`, `what_happens`, `place`, `photo_url` (фото или афиша из анонса, либо `null`).

## Конец запроса — всегда один и тот же

Этот абзац вставляй в конец запроса дословно, не переписывай:

```
The photograph is full-bleed: it fills the entire vertical 9:16 frame from edge to edge, with no borders, no margins, no blank canvas around it and no picture-inside-a-picture. A clean photograph only: no graphic overlays, no shapes, no stickers, no frames. The lower third has no small details. No text, no letters, no numbers, no logos.
```

## Сначала посмотри на фото

Есть `photo_url` — до всего остального один раз вызови `vision_analyze` с этой ссылкой и спроси: что на картинке — настоящая съёмка людей, места или предметов, или это расписание, скриншот, рисунок, коллаж, сплошной текст? Ты не видишь картинку сам, а организаторы присылают что угодно.

- **Уже готовая обложка** — настоящая живая съёмка, вертикальная, без единой надписи, логотипа, рамки и коллажа, резкая и яркая → рисовать нечего: `image_generate` не зови, ответь `cover: keep`. Хоть одно «нет» — не годится, идёшь дальше.
- **Съёмка** (человек, зал, стол с предметами, природа — пусть и под слоем надписей) → раздел «Есть `photo_url`».
- **Не съёмка** (расписание, таблица, скриншот переписки, нарисованная картинка, абстракция, один текст на фоне) → сохранять нечего: раздел «Нет `photo_url`», и `image_url` не передавай.

Сомневаешься — считай, что не съёмка: придуманная по описанию сцена лучше, чем «очищенное» расписание.

## Есть `photo_url`

Афиши организаторов обычно покрыты текстом, наклейками и логотипами — их нужно убрать, а саму съёмку сохранить. Начало запроса:

```
Turn this event poster into a clean photograph: keep the same people, faces, poses, clothes, objects and place, fully photographic, and remove ALL text, letters, numbers, logos, stickers, frames and collage elements. Extend the real scene naturally in every direction until it fills the whole vertical frame; never shrink the photo and never place it on a plain background.
```

Затем абзац про конец запроса. Вызов: `image_generate` с `prompt`, `aspect_ratio: portrait`, `image_url: photo_url`.


## Нет `photo_url` или на нём не съёмка

Сцену придумываешь по `description` и `what_happens`: одно место, главный предмет события, один-два человека. Только то, что есть в описании. Обложка должна цеплять в ленте, а не выглядеть стоковой:

- **момент действия крупно**, а не общий план комнаты: руки бросают кубик, пар валит от камней, пара в развороте танца;
- **люди близко к камере**, занимают заметную часть кадра;
- **цвет и свет**: насыщенные цвета, контраст, закатный или вечерний цветной свет. Бежевые комнаты с дневным светом не годятся;
- **люди разные**: возраст, внешность, одежда. Аудитория — русскоязычные экспаты Дананга, поэтому не все азиаты, и никто не одет одинаково. В запрос — дословно:

  ```
  People: a varied mix of different ages, builds, hair and skin tones, each in their own different clothes - this is the Russian-speaking expat community of Da Nang, so most people are not Asian; never several people who look alike or wear the same outfit.
  ```

Начало запроса:

```
Vivid cinematic photograph shot close to the action, rich saturated colours, strong contrast, warm golden-hour or colourful evening light, shallow depth of field: <момент события одним предложением>.
```

Затем строка про людей и абзац про конец запроса. Вызов: `image_generate` с `prompt` и `aspect_ratio: portrait`.

## Результат

Путь к картинке из ответа инструмента (`image`) — это обложка: в ответе пиши его как `MEDIA:<путь>`. Он же станет первым кадром ролика. Один вызов: не получилось — не повторяй.
