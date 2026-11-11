// Шаблоны событий: вид (эмодзи, цвета) и настройки по умолчанию. Одни и те же для мини-приложения, виджета и MCP.
import type { Event } from './schema.ts';

export interface Template {
  emoji: string;
  name: string; // в выборе шаблона
  label: string; // подпись над названием события
  colors: [string, string];
  placeholder: string;
  max_capacity: number | null;
  allow_plus_one: boolean;
}

export const TEMPLATES: Record<Event['kind'], Template> = {
  f: { emoji: '🍻', name: 'Встреча с друзьями', label: 'Встреча', colors: ['#f59e0b', '#ea580c'], placeholder: 'Ужин в пятницу', max_capacity: null, allow_plus_one: true },
  b: { emoji: '🎂', name: 'День рождения', label: 'День рождения', colors: ['#ec4899', '#8b5cf6'], placeholder: 'Мой день рождения', max_capacity: null, allow_plus_one: true },
  w: { emoji: '💍', name: 'Свадьба', label: 'Свадьба', colors: ['#b08d57', '#7c5c3b'], placeholder: 'Свадьба Лены и Дато', max_capacity: 60, allow_plus_one: true },
  c: { emoji: '💼', name: 'Бизнес и коворкинг', label: 'Коворкинг', colors: ['#2563eb', '#0891b2'], placeholder: 'Завтрак фаундеров', max_capacity: 20, allow_plus_one: false },
  s: { emoji: '⚽', name: 'Спорт и игры', label: 'Спорт', colors: ['#16a34a', '#0d9488'], placeholder: 'Футбол 5×5', max_capacity: 10, allow_plus_one: false },
  o: { emoji: '✨', name: 'Другое', label: 'Событие', colors: ['#6366f1', '#a855f7'], placeholder: 'Название события', max_capacity: null, allow_plus_one: false },
};
