import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import type { Database } from '@nws-commerce/db';
import { supabase } from '../lib/supabase';
import { unwrap } from '../lib/api';
import { useOrg } from '../lib/workspace';
import { qty } from '../lib/format';
import { Input } from '@nws-commerce/ui';

export type VariantHit = Database['public']['Functions']['search_variants']['Returns'][number];

/** Search by name, SKU prefix or exact barcode (a scanner types then presses Enter). */
export function VariantPicker({ onPick, locationId, placeholder = 'Search or scan a product' }: {
  onPick: (v: VariantHit) => void; locationId?: string; placeholder?: string;
}) {
  const org = useOrg();
  const [text, setText] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(text), 180);
    return () => clearTimeout(t);
  }, [text]);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const { data = [] } = useQuery({
    queryKey: ['variant-search', org.id, debounced, locationId],
    enabled: debounced.trim().length > 0,
    queryFn: async () => unwrap(await supabase.rpc('search_variants', {
      p_organization_id: org.id, p_query: debounced.trim(), p_location_id: locationId ?? null, p_limit: 12,
    })),
  });

  function pick(v: VariantHit) {
    onPick(v);
    setText('');
    setDebounced('');
    setOpen(false);
  }

  return (
    <div ref={box} className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-faint" />
      <Input
        className="pl-8"
        placeholder={placeholder}
        value={text}
        onChange={(e) => { setText(e.target.value); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, data.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          if (e.key === 'Enter') {
            e.preventDefault();
            // A scanned barcode or exact SKU is ranked first by the database.
            if (data[active] && debounced === text) pick(data[active]);
          }
          if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && debounced && (
        <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-border bg-surface py-1 shadow-lg" role="listbox">
          {data.length === 0 ? <li className="px-3 py-2 text-sm text-muted">No matching products.</li> : data.map((v, i) => (
            <li key={v.variant_id} role="option" aria-selected={i === active}>
              <button type="button" onMouseEnter={() => setActive(i)} onClick={() => pick(v)}
                className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm ${i === active ? 'bg-surface-2' : ''}`}>
                <span className="min-w-0">
                  <span className="block truncate font-medium">{v.product_name}{v.variant_title !== 'Default' && <span className="font-normal text-muted"> · {v.variant_title}</span>}</span>
                  <span className="block text-xs text-muted">{[v.sku, v.barcode].filter(Boolean).join(' · ') || 'No SKU'}</span>
                </span>
                <span className="num shrink-0 text-xs text-muted">{qty(v.on_hand, v.unit_of_measure)} on hand</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
