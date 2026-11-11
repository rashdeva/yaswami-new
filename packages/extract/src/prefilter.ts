// Дешёвый отсев перед ИИ: у события есть дата, значит в тексте анонса почти всегда есть её признак.
// ponytail: эвристика настроена на полноту, а не точность — лишнее («прямая», «3.5 года») уйдёт в ИИ,
// и это нормально. Станет дорого или шумно — заменить на классификатор по эмбеддингам.
const DATE_SIGNAL = new RegExp([
  String.raw`\d{1,2}[:.]\d{2}`,              // 19:00, 14.11
  String.raw`\d{1,2}\/\d{1,2}`,              // 14/11
  String.raw`\d{1,2}\s?(am|pm)\b`,
  'сегодня|завтра|выходны',
  'понедельник|вторник|сред[уаы]|четверг|пятниц|суббот|воскресень',
  'январ|феврал|март|апрел|мая|июн|июл|август|сентябр|октябр|ноябр|декабр',
  String.raw`\b(today|tonight|tomorrow|weekend)\b`,
  String.raw`\b(mon|tues|wednes|thurs|fri|satur|sun)day\b`,
  String.raw`\b(january|february|march|april|may|june|july|august|september|october|november|december)\b`,
].join('|'), 'i');

export const looksLikeEvent = (text: string) => text.length >= 40 && DATE_SIGNAL.test(text);
