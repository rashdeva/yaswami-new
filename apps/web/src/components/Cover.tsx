/** Карточка события 9:16: одинаковая в витрине и в «моих событиях». Обложки нет — иконка на цветной плитке. */
export interface CoverProps {
  cover_url?: string | null;
  icon: string;
  popular?: boolean;
  /** Строка над названием: время, цена, пометка. */
  meta: string;
  title: string;
  extra?: string;
  /** Есть адрес — карточка настоящая ссылка (Cmd/Ctrl-клик открывает вкладку). */
  href?: string;
  onOpen: () => void;
}

export function Cover({ cover_url, icon, popular, meta, title, extra, href, onOpen }: CoverProps) {
  const body = (
    <>
      {cover_url ? <img className="bg" src={cover_url} alt="" loading="lazy" /> : <img className="ico" src={icon} alt="" loading="lazy" />}
      {popular && <span className="badge sm hot">Популярное</span>}
      {/* Знак «Я с вами» на обложке: так своё видно в ленте. На плитке с иконкой не нужен. */}
      {cover_url && <img className="mark" src="/mark.svg" alt="" />}
      <div className="cap">
        <small>{meta}</small>
        <b>{title}</b>
        {extra && <small>{extra}</small>}
      </div>
    </>
  );
  if (!href) return <button className="cover" onClick={onOpen}>{body}</button>;
  return (
    <a
      className="cover"
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
