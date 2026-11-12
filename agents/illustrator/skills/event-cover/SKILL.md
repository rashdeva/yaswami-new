---
name: event-cover
description: Как одним вызовом image_generate сделать обложку события 9:16 в фирменном стиле «Я с вами» — настоящая фотография плюс слой парящих стеклянных форм. Загружай первым на каждое задание.
---

# Обложка события

Фирменный стиль «Я с вами»: **фотография остаётся настоящей, поверх — слой из жидкого стекла.** Человек, место и предметы — как у организатора; узнаём «наше» по стеклянным формам вокруг.

Данные события: `title`, `description`, `topic`, `what_happens`, `place`, `photo_url` (фото или афиша из анонса, либо `null`).

## Слой — всегда один и тот же

Этот абзац вставляй в запрос дословно, не переписывай: от него зависит, что все обложки выглядят как один набор.

```
The photograph is full-bleed: it fills the entire vertical 9:16 frame from edge to edge, with no borders, no margins, no blank canvas around it and no picture-inside-a-picture. Add a modern graphic layer on top of it: three small floating glossy translucent liquid-glass 3D shapes in lilac, violet and warm peach - one soft blob, one ring and one four-pointed sparkle star. The shapes sit in the corners, partly in front of the picture and refracting it; together they cover no more than a sixth of the frame. Keep faces and the main subject completely clear. The lower third has no small details. No text, no letters, no numbers, no logos.
```

## Сначала посмотри на фото

Есть `photo_url` — до всего остального один раз вызови `vision_analyze` с этой ссылкой и спроси: что на картинке — настоящая съёмка людей, места или предметов, или это расписание, скриншот, рисунок, коллаж, сплошной текст? Ты не видишь картинку сам, а организаторы присылают что угодно.

- **Съёмка** (человек, зал, стол с предметами, природа — пусть и под слоем надписей) → раздел «Есть `photo_url`».
- **Не съёмка** (расписание, таблица, скриншот переписки, нарисованная картинка, абстракция, один текст на фоне) → сохранять нечего: раздел «Нет `photo_url`», и `image_url` не передавай.

Сомневаешься — считай, что не съёмка: придуманная по описанию сцена лучше, чем «очищенное» расписание.

## Есть `photo_url`

Афиши организаторов обычно покрыты текстом, наклейками и логотипами — их нужно убрать, а саму съёмку сохранить. Начало запроса:

```
Turn this event poster into a clean photograph: keep the same people, faces, poses, clothes, objects and place, fully photographic, and remove ALL text, letters, numbers, logos, stickers, frames and collage elements. Extend the real scene naturally in every direction until it fills the whole vertical frame; never shrink the photo and never place it on a plain background.
```

Затем абзац про слой. Вызов: `image_generate` с `prompt`, `aspect_ratio: portrait`, `image_url: photo_url`.


## Нет `photo_url` или на нём не съёмка

Сцену придумываешь по `description` и `what_happens`: одно место, главный предмет события, один-два человека. Только то, что есть в описании. Обложка должна цеплять в ленте, а не выглядеть стоковой:

- **момент действия крупно**, а не общий план комнаты: руки бросают кубик, пар валит от камней, пара в развороте танца;
- **люди близко к камере**, занимают заметную часть кадра;
- **цвет и свет**: насыщенные цвета, контраст, закатный или вечерний цветной свет. Бежевые комнаты с дневным светом не годятся.

Начало запроса:

```
Vivid cinematic photograph shot close to the action, rich saturated colours, strong contrast, warm golden-hour or colourful evening light, shallow depth of field: <момент события одним предложением>.
```

Затем абзац про слой. Вызов: `image_generate` с `prompt` и `aspect_ratio: portrait`.

## Результат

Ссылка на картинку из ответа инструмента (`image` или `public_url`, `https://files-cdn.x.ai/…`) — это обложка. Она же станет первым кадром ролика. Один вызов: не получилось — не повторяй.
