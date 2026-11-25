import { Drawer } from 'vaul';
import type { HostListItem, Practice } from '@yaswami/core';
import { topicIcon, topicSlug } from '@yaswami/core';
import { GuestRow } from './GuestRow.tsx';

interface Props {
  /** Открытая услуга и её мастер; null — шторка закрыта. */
  open: { practice: Practice; host: HostListItem } | null;
  onClose: () => void;
  /** Другая услуга того же мастера — шторка показывает её. */
  onPick: (practice: Practice) => void;
  onSignUp: (host: HostListItem, practice: Practice) => void;
  onOpenHost: (host: HostListItem) => void;
}

/** Шторка услуги: что это, сколько стоит, кто ведёт и что ещё у мастера; внизу одна кнопка «Записаться». */
export function PracticeSheet({ open, onClose, onPick, onSignUp, onOpenHost }: Props) {
  const others = open?.host.practices.filter((p) => p.id !== open.practice.id) ?? [];
  return (
    <Drawer.Root open={!!open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <Drawer.Portal>
        <Drawer.Overlay className="drawer-overlay" />
        <Drawer.Content className="drawer practice-sheet" aria-describedby={undefined}>
          <Drawer.Handle className="drawer-handle" />
          {open && (
            <>
              <div className="practice-head" data-topic={topicSlug(open.practice.topic)}>
                <img src={topicIcon(open.practice.topic)} alt="" />
                <div>
                  <span className="lead">{open.practice.topic[0]!.toUpperCase() + open.practice.topic.slice(1)}</span>
                  <Drawer.Title asChild><h2>{open.practice.title}</h2></Drawer.Title>
                </div>
              </div>
              {open.practice.description && <p>{open.practice.description}</p>}
              <p className="practice-price"><span>Цена</span><b>{open.practice.price ?? 'по запросу — спросите мастера'}</b></p>
              <div className="group">
                <button className="plain" onClick={() => onOpenHost(open.host)}>
                  <GuestRow name={open.host.name} photo={open.host.photo_url} sub="Все услуги и события мастера" label="›" />
                </button>
              </div>
              {others.length > 0 && (
                <>
                  <span className="lead practice-more">Ещё у мастера</span>
                  <div className="group">
                    {others.map((p) => (
                      <button key={p.id} className="plain" onClick={() => onPick(p)}>
                        <div className="guest"><div>{p.title}<small>{p.price ?? 'цена по запросу'}</small></div><span>›</span></div>
                      </button>
                    ))}
                  </div>
                </>
              )}
              <button className="cta" onClick={() => onSignUp(open.host, open.practice)}>Записаться в Telegram</button>
              <p className="note">Откроется чат с мастером. Время подтверждает он сам.</p>
            </>
          )}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
