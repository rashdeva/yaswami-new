---
name: event-video
description: Как по данным события придумать историю из пяти планов и одним вызовом video_generate снять вертикальный ролик со сменой кадров. Загружай на каждое задание.
---

# Ролик-история о событии

Данные события: `title`, `description`, `topic`, `what_happens` (что будет, по порядку), `place`, `photo_url` (фото из анонса организатора или `null`).

## 1. Придумай историю

Ролик — не один красивый кадр, а маленькая история с развитием. Пять планов по две секунды:

1. **Крючок.** Самый притягательный момент события. Есть `photo_url` — это ровно оно: ролик начинается с этого фото.
2. **С чего начинается.** Пустой стол, закрытая дверь, нетронутые материалы — то, что было «до».
3. **Процесс крупно.** Руки, предмет, движение: главное действие события.
4. **Люди.** Двое-трое участников заняты делом или смеются. Лица вскользь, без крупных планов.
5. **Итог.** С чем человек уходит: готовая работа, тепло после парной, компания за столом.

Планы бери из `what_happens` и `description`. Не выдумывай того, чего там нет.

## 2. Напиши запрос

Запрос — на английском, одним абзацем, по образцу. Что в нём обязательно:

- слова о монтаже: `edited as a fast story with HARD CUTS: five different shots of two seconds each, never one continuous take`;
- единство места: `the same room, the same table and the same objects in every shot` — иначе после первого плана начнётся другое место;
- планы списком, между ними `CUT TO SHOT N:`;
- в конце: `No text, no captions, no logos.`

Образец (мастер-класс по флористике, есть фото):

```
Vertical short promo video for a flower arranging workshop, edited as a fast story with HARD CUTS: five different shots of two seconds each, never one continuous take. Handheld phone footage, soft daylight, the same cafe room with wooden tables and the same white and pink flowers in every shot. SHOT 1: starts exactly on this photo, quick push-in on the finished arrangement. CUT TO SHOT 2: an empty glass dish with a metal pin holder in water, loose flowers and scissors beside it on the wooden table. CUT TO SHOT 3: extreme close-up of fingers pressing a flowering branch onto the pin holder. CUT TO SHOT 4: three women at the table laughing while arranging their own flowers, faces soft and out of focus. CUT TO SHOT 5: four finished arrangements in a row on the table, slow pan, warm light. No text, no captions, no logos.
```

## 3. Сними

Один вызов `video_generate`:

- `prompt` — твой запрос;
- `aspect_ratio`: `9:16`;
- `resolution`: `720p`;
- `duration`: `10`;
- `image_url`: `photo_url` из данных, если он есть. Нет фото — без этого параметра, и первый план опиши словами, без `starts exactly on this photo`.

## 4. Ответь

Одной строкой — значением `video` (или `public_url`) из ответа инструмента. Ошибка в ответе — `[[не получилось: …]]`, второй раз не вызывай.
