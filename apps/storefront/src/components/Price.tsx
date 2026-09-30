import { money } from '@/lib/format';

export function Price({ min, max, compareAt, currency, size = 'md' }: {
  min: number; max?: number; compareAt?: number | null; currency: string; size?: 'md' | 'lg';
}) {
  const range = max !== undefined && max !== min;
  const onSale = !range && compareAt && compareAt > min;
  return (
    <span className={`num inline-flex flex-wrap items-baseline gap-x-2 ${size === 'lg' ? 'text-2xl' : 'text-sm'}`}>
      <span className={onSale ? 'font-semibold text-sale' : 'font-semibold text-ink'}>
        {range ? `${money(min, currency)} - ${money(max, currency)}` : money(min, currency)}
      </span>
      {onSale && <span className={`text-ink-3 line-through ${size === 'lg' ? 'text-base' : 'text-xs'}`}>{money(compareAt, currency)}</span>}
    </span>
  );
}
