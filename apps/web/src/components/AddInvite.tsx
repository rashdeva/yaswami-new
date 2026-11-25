import { track } from '../analytics.ts';

interface Props {
  title: string;
  text: string;
  onOpen: () => void;
}

/** Внизу раздела: «делаете сами — добавьте через бота». Ведёт на экран «Добавить» (AddScreen). */
export function AddInvite({ title, text, onOpen }: Props) {
  return (
    <section className="suggest">
      <b>{title}</b>
      <p>{text}</p>
      <button className="cta alt" onClick={() => { track('add_opened', { from: title }); onOpen(); }}>Рассказать боту</button>
    </section>
  );
}
