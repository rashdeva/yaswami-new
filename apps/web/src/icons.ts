// Иконки разделов, которых нет среди иконок тем: направления на «Событиях» и разделы «Услуг».
// Все — в стиле иконок тем (`public/topics`): глянцевый предмет, 192×192, прозрачный фон; рисуются через Codex.

/** Направление на витрине (`DIRECTIONS`) и плитка «Популярное» (`popular`) — `public/directions/<slug>.png`. */
export const directionIcon = (slug: string) => `/directions/${slug}.png`;

/** Раздел «Услуг»: категория услуги, «Детям», «Недорого», «Другое» — `public/categories/<key>.png`. */
export const categoryIcon = (key: string) => `/categories/${key}.png`;
