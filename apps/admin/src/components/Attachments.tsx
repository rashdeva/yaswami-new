// Вложения сообщения в переписке: голосовое и аудио — плеером, видео и кружок — видео, фото — картинкой, файл — ссылкой.
// Под голосовым и видео — расшифровка: её же видит роль Hermes.
import { FileIcon } from 'lucide-react';
import type { MessageMedia } from '@yaswami/core';
import { mediaLabel } from '@yaswami/core';

function Player({ m }: { m: MessageMedia & { url: string } }) {
  switch (m.type) {
    case 'voice':
    case 'audio':
      return <audio controls preload="metadata" src={m.url} className="h-10 w-64 max-w-full" />;
    case 'video':
      return <video controls preload="metadata" src={m.url} className="max-h-80 max-w-full rounded-md" />;
    case 'video_note':
      return <video controls preload="metadata" src={m.url} className="size-48 rounded-full object-cover" />;
    case 'photo':
      return <a href={m.url} target="_blank" rel="noreferrer"><img src={m.url} alt="" className="max-h-80 max-w-full rounded-md" /></a>;
    default:
      return <a href={m.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline"><FileIcon className="size-4" />{mediaLabel(m)}</a>;
  }
}

export function Attachments({ media }: { media: MessageMedia[] | undefined }) {
  if (!media?.length) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {media.map((m, i) => (
        <div key={i} className="flex flex-col gap-1">
          {m.url ? <Player m={{ ...m, url: m.url }} /> : <span className="text-muted-foreground">{mediaLabel(m)} — файл не сохранён</span>}
          {m.transcript && <span className="text-sm italic opacity-80">«{m.transcript}»</span>}
        </div>
      ))}
    </div>
  );
}
