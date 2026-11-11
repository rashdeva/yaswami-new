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
Add a modern graphic layer on top of the photo: three to five floating glossy translucent liquid-glass 3D shapes in lilac, violet and warm peach - soft blobs, one ring and one four-pointed sparkle star. The shapes sit along the edges and in the corners, framing the picture, partly in front of it and refracting it; they cover no more than a quarter of the frame. Keep faces and the main subject completely clear. The scene fills the whole frame down to the bottom edge, and the lower third has no small details. No text, no letters, no numbers, no logos. Vertical 9:16.
```

## Есть `photo_url`

Афиши организаторов обычно покрыты текстом, наклейками и логотипами — их нужно убрать, а саму съёмку сохранить. Начало запроса:

```
Turn this event poster into a clean photograph: keep the same people, faces, poses, clothes, objects and place, fully photographic, and remove ALL text, letters, numbers, logos, stickers, frames and collage elements, extending the scene naturally to fill a vertical frame.
```

Затем абзац про слой. Вызов: `image_generate` с `prompt`, `aspect_ratio: portrait`, `image_url: photo_url`.

Если на фото вообще нет съёмки — расписание, скриншот, сплошной текст на цветном фоне, — сохранять нечего: действуй как без фото и `image_url` не передавай.

## Нет `photo_url`

Сцену придумываешь по `description` и `what_happens`: одно место, главный предмет события, один-два человека со спины или вполоборота. Только то, что есть в описании. Начало запроса:

```
Natural editorial photograph, soft warm daylight, shallow depth of field: <сцена события одним предложением>.
```

Затем абзац про слой. Вызов: `image_generate` с `prompt` и `aspect_ratio: portrait`.

## Результат

Ссылка на картинку из ответа инструмента (`image` или `public_url`, `https://files-cdn.x.ai/…`) — это обложка. Она же станет первым кадром ролика. Один вызов: не получилось — не повторяй.
