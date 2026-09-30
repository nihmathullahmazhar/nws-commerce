import { mediaUrl } from '@/lib/format';
import { cn } from '@/lib/cn';

/**
 * The product photo, or - until one is uploaded - a quiet tile with the
 * product's initials. Never a stock photo pretending to be the product.
 */
export function ProductImage({ path, name, className, sizes = 'md' }: {
  path: string | null | undefined; name: string; className?: string; sizes?: 'sm' | 'md' | 'lg';
}) {
  const url = mediaUrl(path);
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={name} loading="lazy" className={cn('aspect-square w-full rounded-md bg-tile object-cover', className)} />;
  }
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('');
  return (
    <div aria-hidden className={cn('grid aspect-square w-full place-items-center rounded-md bg-tile text-ink-3', className)}>
      <span className={cn('font-semibold tracking-wide', sizes === 'sm' ? 'text-sm' : sizes === 'lg' ? 'text-5xl' : 'text-2xl')}>{initials}</span>
    </div>
  );
}
