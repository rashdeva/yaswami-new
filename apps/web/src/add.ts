// Экран «Добавить» (AddScreen): форм нет, человек пишет боту, бот разбирает. Здесь — примеры для показа разбора
// и чистая разметка сообщения: какие куски текста стали какими полями. Сам разбор делает роль поддержки Hermes.

/** Что можно добавить через бота. Порядок — порядок плашек и показа. */
export const ADD_KINDS = ['event', 'product', 'service'] as const;
export type AddKind = (typeof ADD_KINDS)[number];
export const isAddKind = (v: unknown): v is AddKind => ADD_KINDS.includes(v as AddKind);

export interface DemoField {
  label: string;
  value: string;
  /** Кусок сообщения, из которого бот взял поле; нет — поле выведено по смыслу (категория). */
  source?: string;
}

export interface AddExample {
  kind: AddKind;
  chip: string; // подпись плашки
  emoji: string;
  title: string; // заголовок карточки, которую собрал бот
  message: string; // что человек пишет боту
  fields: DemoField[];
}

export const ADD_EXAMPLES: Record<AddKind, AddExample> = {
  event: {
    kind: 'event', chip: 'Событие', emoji: '🗓', title: 'Событие',
    message: 'Йога на закате в субботу в 18:00, Green One на My Khe. 150k, коврики дадим, ведёт @anya_yoga 🧘',
    fields: [
      { label: 'Что', value: 'Йога на закате', source: 'Йога на закате' },
      { label: 'Когда', value: 'Суббота, 18:00', source: 'в субботу в 18:00' },
      { label: 'Где', value: 'Green One, My Khe', source: 'Green One на My Khe' },
      { label: 'Цена', value: '150k', source: '150k' },
      { label: 'Ведёт', value: '@anya_yoga', source: '@anya_yoga' },
    ],
  },
  product: {
    kind: 'product', chip: 'Товар', emoji: '🛍', title: 'Товар',
    message: 'Пеку медовик порционно 🍯 Кусочек 100 г — 55k, можно с доставкой по Сон Чя',
    fields: [
      { label: 'Товар', value: 'Медовик порционно', source: 'медовик порционно' },
      { label: 'Вес', value: '100 г', source: '100 г' },
      { label: 'Цена', value: '55k', source: '55k' },
      { label: 'Доставка', value: 'Сон Чя', source: 'с доставкой по Сон Чя' },
      { label: 'Категория', value: '🎂 Выпечка и десерты' },
    ],
  },
  service: {
    kind: 'service', chip: 'Услуга', emoji: '💆', title: 'Услуга',
    message: 'Делаю массаж спины и шеи, 60 минут — 400k. Приезжаю к вам домой 🌿',
    fields: [
      { label: 'Услуга', value: 'Массаж спины и шеи', source: 'массаж спины и шеи' },
      { label: 'Длится', value: '1 час', source: '60 минут' },
      { label: 'Цена', value: '400k', source: '400k' },
      { label: 'Формат', value: 'Выезд на дом', source: 'Приезжаю к вам домой' },
      { label: 'Категория', value: '💆 Массаж и тело' },
    ],
  },
};

/** Кусок сообщения; `field` — номер поля, которое из него взято. */
export interface Segment {
  text: string;
  field?: number;
}

/** Делит сообщение на куски по источникам полей: первое вхождение, пересечения пропускаются. */
export function segments(message: string, fields: DemoField[]): Segment[] {
  const spans = fields
    .flatMap((f, field) => {
      const start = f.source ? message.indexOf(f.source) : -1;
      return start < 0 ? [] : [{ start, end: start + f.source!.length, field }];
    })
    .sort((a, b) => a.start - b.start);
  const out: Segment[] = [];
  let at = 0;
  for (const s of spans) {
    if (s.start < at) continue;
    if (s.start > at) out.push({ text: message.slice(at, s.start) });
    out.push({ text: message.slice(s.start, s.end), field: s.field });
    at = s.end;
  }
  if (at < message.length) out.push({ text: message.slice(at) });
  return out;
}
