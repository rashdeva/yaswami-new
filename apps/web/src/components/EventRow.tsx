import type { CollectedBadge } from '@yaswami/core';

/** Строка ленты: время слева, название и подробности, квадратное превью справа. Одна в витрине и в «моих событиях».
 *  Карточка 9:16 (`Cover`) лежит рядом — пока не используется. */
export interface EventRowProps {
  /** «19:00»; пусто — в анонсе времени нет. */
  time: string;
  title: string;
  /** Строка под названием: место, цена, пометка. */
  sub?: string;
  /** Обложка, обрезанная в квадрат; нет — иконка темы. */
  cover_url?: string | null;
  icon: string;
  /** Пометки под названием: «Скоро», «Популярное», «Бесплатно». */
  badges?: CollectedBadge[];
  /** Есть адрес — строка настоящая ссылка (Cmd/Ctrl-клик открывает вкладку). */
  href?: string;
  onOpen: () => void;
}

export function EventRow({ time, title, sub, cover_url, icon, badges, href, onOpen }: EventRowProps) {
  const body = (
    <>
      <time>{time || '—'}</time>
      <div>
        <b>{title}</b>
        {sub && <small>{sub}</small>}
        {badges?.map((b) => <span key={b.kind} className={`badge sm ${b.kind}`}>{b.label}</span>)}
      </div>
      {cover_url ? <img className="th" src={cover_url} alt="" loading="lazy" /> : <img className="th ico" src={icon} alt="" loading="lazy" />}
    </>
  );
  if (!href) return <button className="ev" onClick={onOpen}>{body}</button>;
  return (
    <a
      className="ev"
      href={href}
      onClick={(click) => {
        if (click.metaKey || click.ctrlKey || click.shiftKey) return;
        click.preventDefault();
        onOpen();
      }}
    >
      {body}
    </a>
  );
}
