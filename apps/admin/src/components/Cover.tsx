// Обложка собранного события: вертикальная 9:16, без картинки — пустая плашка.
import { AspectRatio } from '@/components/ui/aspect-ratio';
import { Empty, EmptyDescription } from '@/components/ui/empty';

export function Cover({ url, className }: { url: string | null | undefined; className?: string }) {
  return (
    <div className={className}>
      <AspectRatio ratio={9 / 16} className="overflow-hidden rounded-md bg-muted">
        {url ? <img src={url} alt="" loading="lazy" className="size-full object-cover" />
          : <Empty className="size-full p-1"><EmptyDescription className="text-xs">нет</EmptyDescription></Empty>}
      </AspectRatio>
    </div>
  );
}
