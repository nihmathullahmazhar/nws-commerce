import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgePercent, Plus } from 'lucide-react';
import type { Enums, Json, Tables } from '@nws-commerce/db';
import { Badge, Button, Card, Checkbox, Dialog, EmptyState, ErrorNote, Field, Input, PageHeader, Select, Spinner, Table, Td, Th, useToast } from '@nws-commerce/ui';
import { supabase } from '../lib/supabase';
import { unwrap } from '../lib/api';
import { useOrg } from '../lib/workspace';
import { CHANNEL } from '../lib/labels';
import { date, money } from '../lib/format';

type Promo = Tables<'promotions'>;

function describe(p: Promo, currency: string) {
  if (p.kind === 'buy_x_get_y') return `Buy ${p.buy_quantity} get ${p.get_quantity} free`;
  const v = p.kind === 'percent_off' ? `${p.value}% off` : `${money(p.value, currency)} off`;
  return p.scope === 'order' ? `${v} the order${p.min_subtotal ? ` over ${money(p.min_subtotal, currency)}` : ''}` : v;
}

function liveState(p: Promo): { label: string; tone: 'ok' | 'neutral' | 'warn' | 'info' } {
  const now = Date.now();
  if (!p.is_active) return { label: 'Off', tone: 'neutral' };
  if (p.starts_at && new Date(p.starts_at).getTime() > now) return { label: 'Scheduled', tone: 'info' };
  if (p.ends_at && new Date(p.ends_at).getTime() <= now) return { label: 'Ended', tone: 'neutral' };
  if (p.usage_limit !== null && p.usage_count >= p.usage_limit) return { label: 'Used up', tone: 'warn' };
  return { label: 'Live', tone: 'ok' };
}

export function Promotions() {
  const org = useOrg();
  const [editing, setEditing] = useState<Partial<Promo> | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ['promotions', org.id],
    queryFn: async () => unwrap(await supabase.from('promotions').select('*').eq('organization_id', org.id).order('created_at', { ascending: false })),
  });
  return (
    <>
      <PageHeader title="Promotions" description="Automatic offers and coupon codes. They apply the same way at the till, online and in the app."
        actions={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing({ kind: 'percent_off', scope: 'products', is_active: true, product_ids: [], category_ids: [], brand_ids: [] })}>New promotion</Button>} />
      <Card padded={false}>
        <ErrorNote error={error} />
        {isLoading ? <Spinner /> : !data?.length ? (
          <EmptyState icon={<BadgePercent className="size-5" />} title="No promotions yet">
            For example: 20% off a category for the weekend, buy 2 get 1 on socks, or Rs 1,000 off orders over Rs 10,000 with a code.
            The best offer applies to each item automatically; manual discounts replace promotions rather than adding to them.
          </EmptyState>
        ) : (
          <Table>
            <thead><tr><Th>Promotion</Th><Th>Offer</Th><Th>Code</Th><Th>When</Th><Th align="right">Used</Th><Th>Status</Th></tr></thead>
            <tbody>
              {data.map((p) => {
                const st = liveState(p);
                return (
                  <tr key={p.id} className="hover:bg-surface-2/60">
                    <Td><button className="font-medium hover:text-accent" onClick={() => setEditing(p)}>{p.name}</button>
                      <div className="text-xs text-muted">{p.channels ? p.channels.map((c) => CHANNEL[c]).join(', ') : 'All channels'}</div></Td>
                    <Td>{describe(p, org.currency)}</Td>
                    <Td className="font-mono text-xs">{p.coupon_code ?? <span className="font-sans text-muted">automatic</span>}</Td>
                    <Td className="text-muted">{p.starts_at || p.ends_at ? `${p.starts_at ? date(p.starts_at) : 'now'} - ${p.ends_at ? date(p.ends_at) : 'no end'}` : 'Always'}</Td>
                    <Td align="right">{p.usage_count}{p.usage_limit !== null && ` / ${p.usage_limit}`}</Td>
                    <Td><Badge tone={st.tone}>{st.label}</Badge></Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
      {editing && <PromoEditor promo={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

const toLocal = (v: string | null | undefined) => (v ? new Date(v).toISOString().slice(0, 16) : '');

function PromoEditor({ promo, onClose }: { promo: Partial<Promo>; onClose: () => void }) {
  const org = useOrg();
  const qc = useQueryClient();
  const toast = useToast();
  const [p, setP] = useState<Partial<Promo>>(promo);
  const [target, setTarget] = useState<'all' | 'categories' | 'brands' | 'products'>(
    promo.category_ids?.length ? 'categories' : promo.brand_ids?.length ? 'brands' : promo.product_ids?.length ? 'products' : 'all');
  const lookups = useQuery({
    queryKey: ['promo-lookups', org.id],
    queryFn: async () => {
      const [c, b, pr] = await Promise.all([
        supabase.from('categories').select('id, name').eq('organization_id', org.id).order('name'),
        supabase.from('brands').select('id, name').eq('organization_id', org.id).order('name'),
        supabase.from('products').select('id, name').eq('organization_id', org.id).neq('status', 'archived').order('name').limit(500),
      ]);
      return { categories: unwrap(c), brands: unwrap(b), products: unwrap(pr) };
    },
  });
  const save = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('save_promotion', {
      p_organization_id: org.id,
      p_promo: {
        ...p,
        product_ids: target === 'products' ? p.product_ids : [], category_ids: target === 'categories' ? p.category_ids : [],
        brand_ids: target === 'brands' ? p.brand_ids : [],
        starts_at: p.starts_at || null, ends_at: p.ends_at || null,
      } as unknown as Json,
    })),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['promotions'] }); toast('Promotion saved'); onClose(); },
  });
  const set = (patch: Partial<Promo>) => setP((x) => ({ ...x, ...patch }));
  const list = target === 'categories' ? lookups.data?.categories : target === 'brands' ? lookups.data?.brands : lookups.data?.products;
  const key = target === 'categories' ? 'category_ids' : target === 'brands' ? 'brand_ids' : 'product_ids';
  const chosen = (p[key as 'product_ids'] ?? []) as string[];

  return (
    <Dialog open onClose={onClose} wide title={promo.id ? 'Edit promotion' : 'New promotion'}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={save.isPending} disabled={!p.name?.trim()} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="space-y-5">
        <ErrorNote error={save.error} />
        <Field label="Name" hint="Shown on receipts and order summaries."><Input value={p.name ?? ''} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Weekend 20% off shirts" /></Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Offer">
            <Select value={p.kind} onChange={(e) => set({ kind: e.target.value as Enums['promotion_kind'], ...(e.target.value === 'buy_x_get_y' ? { scope: 'products' } : {}) })}>
              <option value="percent_off">Percent off</option><option value="amount_off">Amount off</option><option value="buy_x_get_y">Buy X get Y free</option>
            </Select>
          </Field>
          <Field label="Applies to">
            <Select value={p.scope} disabled={p.kind === 'buy_x_get_y'} onChange={(e) => set({ scope: e.target.value as Enums['promotion_scope'] })}>
              <option value="products">Items</option><option value="order">The whole order</option>
            </Select>
          </Field>
          {p.kind === 'buy_x_get_y' ? (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Buy"><Input type="number" min="1" value={p.buy_quantity ?? ''} onChange={(e) => set({ buy_quantity: Number(e.target.value) || null })} /></Field>
              <Field label="Get free"><Input type="number" min="1" value={p.get_quantity ?? ''} onChange={(e) => set({ get_quantity: Number(e.target.value) || null })} /></Field>
            </div>
          ) : (
            <Field label={p.kind === 'percent_off' ? 'Percent' : `Amount (${org.currency})${p.scope === 'products' ? ' per item' : ''}`}>
              <Input type="number" min="0" step="0.01" value={p.value ?? ''} onChange={(e) => set({ value: Number(e.target.value) })} />
            </Field>
          )}
        </div>
        {p.scope === 'order' ? (
          <Field label={`Minimum spend (${org.currency})`}><Input type="number" min="0" value={p.min_subtotal ?? ''} onChange={(e) => set({ min_subtotal: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
        ) : (
          <div>
            <Field label="Which items">
              <Select value={target} onChange={(e) => setTarget(e.target.value as typeof target)}>
                <option value="all">Everything</option><option value="categories">Categories</option><option value="brands">Brands</option><option value="products">Specific products</option>
              </Select>
            </Field>
            {target !== 'all' && (
              <div className="mt-2 grid max-h-44 gap-1.5 overflow-y-auto rounded-md border border-border p-3 sm:grid-cols-2">
                {list?.map((x) => (
                  <Checkbox key={x.id} label={x.name} checked={chosen.includes(x.id)}
                    onChange={(on) => set({ [key]: on ? [...chosen, x.id] : chosen.filter((y) => y !== x.id) } as Partial<Promo>)} />
                ))}
                {!list?.length && <p className="text-sm text-muted">None yet.</p>}
              </div>
            )}
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Coupon code" hint="Empty = applies automatically."><Input className="font-mono uppercase" value={p.coupon_code ?? ''} onChange={(e) => set({ coupon_code: e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '') || null })} /></Field>
          <Field label="Starts"><Input type="datetime-local" value={toLocal(p.starts_at)} onChange={(e) => set({ starts_at: e.target.value ? new Date(e.target.value).toISOString() : null })} /></Field>
          <Field label="Ends"><Input type="datetime-local" value={toLocal(p.ends_at)} onChange={(e) => set({ ends_at: e.target.value ? new Date(e.target.value).toISOString() : null })} /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Use limit" hint="Total times it can be used. Empty = no limit."><Input type="number" min="1" value={p.usage_limit ?? ''} onChange={(e) => set({ usage_limit: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
          <fieldset>
            <legend className="mb-1 text-[13px] font-medium">Channels</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {(['pos', 'online', 'mobile_app', 'phone_order'] as const).map((c) => (
                <Checkbox key={c} label={CHANNEL[c]} checked={!p.channels || p.channels.includes(c)}
                  onChange={(on) => {
                    const all = ['pos', 'online', 'mobile_app', 'phone_order', 'admin_order'] as Enums['sales_channel'][];
                    const cur = p.channels ?? all;
                    const next = on ? [...cur, c] : cur.filter((x) => x !== c);
                    set({ channels: next.length >= all.length - 1 && next.includes('pos') && next.includes('online') && next.includes('mobile_app') && next.includes('phone_order') ? null : next });
                  }} />
              ))}
            </div>
          </fieldset>
        </div>
        <Checkbox label="Active" checked={p.is_active ?? true} onChange={(v) => set({ is_active: v })} />
      </div>
    </Dialog>
  );
}
