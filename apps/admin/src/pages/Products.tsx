import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Package, Plus, Search } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { unwrap } from '../lib/api';
import { useOrg } from '../lib/workspace';
import { money } from '../lib/format';
import { Badge, Button, Card, EmptyState, ErrorNote, Input, PageHeader, Select, Spinner, Table, Td, Th } from '@nws-commerce/ui';

const STATUS_TONE = { active: 'ok', draft: 'neutral', archived: 'warn' } as const;

export function Products() {
  const org = useOrg();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | 'active' | 'draft' | 'archived'>('all');

  const { data, error, isLoading } = useQuery({
    queryKey: ['products', org.id, status, search],
    queryFn: async () => {
      let q = supabase.from('products')
        .select('id, name, status, tracking_mode, unit_of_measure, updated_at, brands(name), categories(name), product_variants(id, price, sku, is_active)')
        .eq('organization_id', org.id)
        .order('updated_at', { ascending: false })
        .limit(200);
      if (status !== 'all') q = q.eq('status', status);
      if (search.trim()) q = q.ilike('name', `%${search.trim()}%`);
      return unwrap(await q);
    },
  });

  const canEdit = org.can('catalog.manage');

  return (
    <>
      <PageHeader title="Products"
        description="Everything you sell, online and at the counter."
        actions={canEdit && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => navigate('/products/new')}>Add product</Button>} />
      <Card padded={false}>
        <div className="flex flex-wrap gap-2 border-b border-border p-3">
          <div className="relative min-w-52 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-faint" />
            <Input className="pl-8" placeholder="Search by name" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select className="w-40" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="draft">Draft</option>
            <option value="archived">Archived</option>
          </Select>
        </div>
        <ErrorNote error={error} />
        {isLoading ? <Spinner /> : !data?.length ? (
          search || status !== 'all'
            ? <EmptyState title="No products match" icon={<Search className="size-5" />}>Try another name or status.</EmptyState>
            : <EmptyState title="No products yet" icon={<Package className="size-5" />}
                action={canEdit && <Button variant="primary" onClick={() => navigate('/products/new')}>Add your first product</Button>}>
                A product can have variants, such as sizes and colours, each with its own SKU, barcode and price.
                Draft products stay hidden from the store until you make them active.
              </EmptyState>
        ) : (
          <Table>
            <thead><tr><Th>Product</Th><Th>Category</Th><Th>Variants</Th><Th align="right">Price</Th><Th>Status</Th></tr></thead>
            <tbody>
              {data.map((p) => {
                const active = p.product_variants.filter((v) => v.is_active);
                const prices = active.map((v) => v.price);
                const min = prices.length ? Math.min(...prices) : null;
                const max = prices.length ? Math.max(...prices) : null;
                return (
                  <tr key={p.id} className="hover:bg-surface-2/60">
                    <Td>
                      <Link to={`/products/${p.id}`} className="font-medium text-text hover:text-accent">{p.name}</Link>
                      <div className="text-xs text-muted">
                        {[p.brands?.name, p.tracking_mode !== 'none' && `${p.tracking_mode}-tracked`, p.unit_of_measure !== 'each' && `sold per ${p.unit_of_measure}`].filter(Boolean).join(' · ')}
                      </div>
                    </Td>
                    <Td className="text-muted">{p.categories?.name ?? '-'}</Td>
                    <Td className="text-muted">{active.length}</Td>
                    <Td align="right">{min === null ? '-' : min === max ? money(min, org.currency) : `${money(min, org.currency)} - ${money(max, org.currency)}`}</Td>
                    <Td><Badge tone={STATUS_TONE[p.status]}>{p.status}</Badge></Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
