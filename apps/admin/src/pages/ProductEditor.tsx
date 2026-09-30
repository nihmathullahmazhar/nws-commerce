import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Trash2, X } from 'lucide-react';
import type { Enums, Json } from '@nws-commerce/db';
import { supabase } from '../lib/supabase';
import { unwrap } from '../lib/api';
import { useOrg } from '../lib/workspace';
import {
  Badge, Button, Card, Checkbox, ErrorNote, Field, Input, PageHeader, Select, Spinner, Table, Td, Textarea, Th, useToast,
} from '@nws-commerce/ui';

interface OptionDraft { name: string; values: string[] }
interface VariantDraft {
  id?: string; option_values: string[]; sku: string; barcode: string;
  price: string; compare_at_price: string; is_active: boolean;
}
interface ProductDraft {
  name: string; slug: string; summary: string; description: string;
  status: Enums['product_status']; brand_id: string; category_id: string;
  tracking_mode: Enums['tracking_mode']; unit_of_measure: string; allow_fractional: boolean;
  tax_rate_id: string; tax_exempt: boolean;
}

const EMPTY: ProductDraft = {
  name: '', slug: '', summary: '', description: '', status: 'draft', brand_id: '', category_id: '',
  tracking_mode: 'none', unit_of_measure: 'each', allow_fractional: false, tax_rate_id: '', tax_exempt: false,
};

const keyOf = (values: string[]) => values.map((v) => v.trim().toLowerCase()).join('|');

function combinations(options: OptionDraft[]): string[][] {
  const usable = options.filter((o) => o.name.trim() && o.values.length);
  if (!usable.length) return [[]];
  return usable.reduce<string[][]>((acc, o) => acc.flatMap((prefix) => o.values.map((v) => [...prefix, v])), [[]]);
}

export function ProductEditor() {
  const { id } = useParams();
  const isNew = !id;
  const org = useOrg();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const canEdit = org.can('catalog.manage');

  const [draft, setDraft] = useState<ProductDraft>(EMPTY);
  const [options, setOptions] = useState<OptionDraft[]>([]);
  const [variants, setVariants] = useState<VariantDraft[]>([{ option_values: [], sku: '', barcode: '', price: '', compare_at_price: '', is_active: true }]);
  const [attributes, setAttributes] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(isNew);
  const [warranty, setWarranty] = useState({ months: '', terms: '' });
  const [giftCard, setGiftCard] = useState(false);

  const lookups = useQuery({
    queryKey: ['catalogue-lookups', org.id],
    queryFn: async () => {
      const [brands, categories, taxRates, attrs] = await Promise.all([
        supabase.from('brands').select('id, name').eq('organization_id', org.id).eq('is_active', true).order('name'),
        supabase.from('categories').select('id, name, category_attributes(attribute_id, position, is_required)').eq('organization_id', org.id).eq('is_active', true).order('name'),
        supabase.from('tax_rates').select('id, name, rate_percent, is_default').eq('organization_id', org.id).eq('is_active', true).order('rate_percent'),
        supabase.from('attribute_definitions').select('*').eq('organization_id', org.id).order('label'),
      ]);
      return { brands: unwrap(brands), categories: unwrap(categories), taxRates: unwrap(taxRates), attributes: unwrap(attrs) };
    },
  });

  const existing = useQuery({
    queryKey: ['product', id],
    enabled: !isNew,
    queryFn: async () => unwrap(await supabase.from('products')
      .select('*, product_options(id, name, position, product_option_values(value, position)), product_variants(*, variant_option_values(option_value_id, product_option_values(value, option_id))), product_attribute_values(attribute_id, value)')
      .eq('id', id!).single()),
  });

  const hasStock = useQuery({
    queryKey: ['product-has-stock', id],
    enabled: !!existing.data,
    queryFn: async () => {
      const ids = existing.data?.product_variants.map((v) => v.id) ?? [];
      if (!ids.length) return false;
      const { count } = await supabase.from('inventory_movements').select('id', { count: 'exact', head: true }).in('variant_id', ids);
      return (count ?? 0) > 0;
    },
  });

  // Hydrate the form once from the saved product.
  useEffect(() => {
    const p = existing.data;
    if (!p || loaded) return;
    const opts = [...p.product_options].sort((a, b) => a.position - b.position);
    setDraft({
      name: p.name, slug: p.slug, summary: p.summary ?? '', description: p.description ?? '', status: p.status,
      brand_id: p.brand_id ?? '', category_id: p.category_id ?? '', tracking_mode: p.tracking_mode,
      unit_of_measure: p.unit_of_measure, allow_fractional: p.allow_fractional,
      tax_rate_id: p.tax_rate_id ?? '', tax_exempt: p.tax_exempt,
    });
    setOptions(opts.map((o) => ({ name: o.name, values: [...o.product_option_values].sort((a, b) => a.position - b.position).map((v) => v.value) })));
    setVariants([...p.product_variants].sort((a, b) => a.position - b.position).map((v) => {
      const byOption = new Map(v.variant_option_values.map((x) => [x.product_option_values?.option_id, x.product_option_values?.value]));
      return {
        id: v.id,
        option_values: opts.map((o) => byOption.get(o.id) ?? ''),
        sku: v.sku ?? '', barcode: v.barcode ?? '', price: String(v.price),
        compare_at_price: v.compare_at_price === null ? '' : String(v.compare_at_price), is_active: v.is_active,
      };
    }));
    setGiftCard(p.is_gift_card);
    setWarranty({ months: p.warranty_months === null ? '' : String(p.warranty_months), terms: p.warranty_terms ?? '' });
    setAttributes(Object.fromEntries(p.product_attribute_values.map((a) => [a.attribute_id, typeof a.value === 'string' ? a.value : JSON.stringify(a.value)])));
    setLoaded(true);
  }, [existing.data, loaded]);

  // Keep one variant per option combination, preserving what was typed.
  function applyOptions(next: OptionDraft[]) {
    setOptions(next);
    setVariants((current) => {
      const byKey = new Map(current.map((v) => [keyOf(v.option_values), v]));
      const template = current.find((v) => v.is_active) ?? current[0];
      const combos = combinations(next);
      const rebuilt = combos.map((combo) => byKey.get(keyOf(combo)) ?? {
        option_values: combo, sku: '', barcode: '', price: template?.price ?? '', compare_at_price: '', is_active: true,
      });
      // Saved variants that no longer fit are kept, switched off, so their history stays.
      const retired = current.filter((v) => v.id && !combos.some((c) => keyOf(c) === keyOf(v.option_values)))
        .map((v) => ({ ...v, is_active: false }));
      return [...rebuilt, ...retired];
    });
  }

  const categoryAttributes = useMemo(() => {
    const cat = lookups.data?.categories.find((c) => c.id === draft.category_id);
    if (!cat) return [];
    return [...cat.category_attributes].sort((a, b) => a.position - b.position)
      .map((ca) => ({ ...ca, def: lookups.data!.attributes.find((a) => a.id === ca.attribute_id)! }))
      .filter((x) => x.def);
  }, [lookups.data, draft.category_id]);

  const save = useMutation({
    mutationFn: async () => {
      const liveCombos = new Set(combinations(options).map(keyOf));
      const payload = {
        ...(isNew ? {} : { id }),
        ...draft,
        brand_id: draft.brand_id || null, category_id: draft.category_id || null, tax_rate_id: draft.tax_rate_id || null,
        options: options.filter((o) => o.name.trim() && o.values.length),
        variants: variants
          .filter((v) => liveCombos.has(keyOf(v.option_values)))
          .map((v) => ({
            ...(v.id ? { id: v.id } : {}), option_values: v.option_values, sku: v.sku, barcode: v.barcode,
            price: v.price === '' ? null : Number(v.price),
            compare_at_price: v.compare_at_price === '' ? null : Number(v.compare_at_price), is_active: v.is_active,
          })),
        attributes: Object.fromEntries(categoryAttributes.map((ca) => {
          const raw = attributes[ca.attribute_id] ?? '';
          const value = raw === '' ? null : ca.def.data_type === 'number' ? Number(raw) : ca.def.data_type === 'boolean' ? raw === 'true' : raw;
          return [ca.attribute_id, value];
        })),
      };
      // The gift-card flag needs a non-stock product, so it is cleared before and set after the save.
      if (!isNew && !giftCard) unwrap(await supabase.from('products').update({ is_gift_card: false }).eq('id', id!).select('id'));
      const productId = unwrap(await supabase.rpc('save_product', { p_organization_id: org.id, p_product: payload as unknown as Json }));
      if (giftCard) unwrap(await supabase.from('products').update({ is_gift_card: true }).eq('id', productId).select('id'));
      if (org.has('warranty')) {
        unwrap(await supabase.rpc('set_product_warranty', {
          p_product_id: productId, p_months: warranty.months === '' ? null : Number(warranty.months), p_terms: warranty.terms || null,
        }));
      }
      return productId;
    },
    onSuccess: (productId) => {
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['product', productId] });
      toast(isNew ? 'Product created' : 'Product saved');
      if (isNew) navigate(`/products/${productId}`, { replace: true });
      else setLoaded(false);
    },
  });

  if (!isNew && (existing.isLoading || !loaded)) return existing.error ? <ErrorNote error={existing.error} /> : <Spinner />;

  const set = <K extends keyof ProductDraft>(k: K, v: ProductDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const setVariant = (i: number, patch: Partial<VariantDraft>) => setVariants((vs) => vs.map((v, j) => (j === i ? { ...v, ...patch } : v)));
  const trackingLocked = !isNew && hasStock.data === true;

  return (
    <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <PageHeader
        back={<Link to="/products" className="inline-flex items-center gap-1 text-sm text-muted hover:text-text"><ArrowLeft className="size-4" />Products</Link>}
        title={isNew ? 'New product' : draft.name || 'Product'}
        description={!isNew && <span>/{draft.slug}</span>}
        actions={canEdit && <Button type="submit" variant="primary" busy={save.isPending}>{isNew ? 'Create product' : 'Save changes'}</Button>}
      />
      <fieldset disabled={!canEdit} className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <ErrorNote error={save.error} />

          <Card title="Details">
            <div className="space-y-4">
              <Field label="Name"><Input required value={draft.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Linen shirt, Basmati rice, 65W charger" /></Field>
              <Field label="Short summary" hint="One line shown in product lists."><Input value={draft.summary} onChange={(e) => set('summary', e.target.value)} /></Field>
              <Field label="Description"><Textarea rows={5} value={draft.description} onChange={(e) => set('description', e.target.value)} /></Field>
              {!isNew && <Field label="URL slug" hint="Changing it changes the product's web address."><Input value={draft.slug} onChange={(e) => set('slug', e.target.value)} /></Field>}
            </div>
          </Card>

          <Card title="Options" description="Add options such as Size or Colour. Every combination becomes a variant with its own price, SKU and stock."
            actions={options.length < 3 && <Button type="button" size="sm" icon={<Plus className="size-3.5" />} onClick={() => applyOptions([...options, { name: '', values: [] }])}>Add option</Button>}>
            {options.length === 0 ? (
              <p className="text-sm text-muted">No options: this product is sold as a single item.</p>
            ) : (
              <div className="space-y-4">
                {options.map((o, i) => (
                  <OptionRow key={i} option={o}
                    onChange={(next) => applyOptions(options.map((x, j) => (j === i ? next : x)))}
                    onRemove={() => applyOptions(options.filter((_, j) => j !== i))} />
                ))}
              </div>
            )}
          </Card>

          <Card title="Variants" padded={false}
            description={draft.tax_exempt ? 'Prices carry no tax.' : org.pricesIncludeTax ? 'Prices include tax.' : 'Tax is added on top of these prices.'}>
            <Table>
              <thead><tr><Th>Variant</Th><Th>SKU</Th><Th>Barcode</Th><Th align="right">Price</Th><Th align="right">Compare at</Th><Th align="center">On sale</Th></tr></thead>
              <tbody>
                {variants.map((v, i) => {
                  const live = combinations(options).some((c) => keyOf(c) === keyOf(v.option_values));
                  if (!live) return null;
                  return (
                    <tr key={v.id ?? keyOf(v.option_values)} className={v.is_active ? '' : 'opacity-60'}>
                      <Td className="whitespace-nowrap font-medium">{v.option_values.length ? v.option_values.join(' / ') : 'Default'}</Td>
                      <Td><Input className="h-8 min-w-28" value={v.sku} onChange={(e) => setVariant(i, { sku: e.target.value })} /></Td>
                      <Td><Input className="h-8 min-w-32" inputMode="numeric" value={v.barcode} onChange={(e) => setVariant(i, { barcode: e.target.value })} /></Td>
                      <Td align="right"><Input className="h-8 w-28 text-right" type="number" min="0" step="0.01" required value={v.price} onChange={(e) => setVariant(i, { price: e.target.value })} /></Td>
                      <Td align="right"><Input className="h-8 w-28 text-right" type="number" min="0" step="0.01" value={v.compare_at_price} onChange={(e) => setVariant(i, { compare_at_price: e.target.value })} /></Td>
                      <Td align="center"><input type="checkbox" className="size-4 accent-[var(--accent)]" checked={v.is_active} onChange={(e) => setVariant(i, { is_active: e.target.checked })} aria-label="Variant on sale" /></Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            {variants.some((v) => v.id && !combinations(options).some((c) => keyOf(c) === keyOf(v.option_values))) && (
              <p className="border-t border-border px-4 py-2.5 text-xs text-muted">
                Variants whose option values you removed will be switched off, not deleted, so past sales keep their history.
              </p>
            )}
          </Card>

          {categoryAttributes.length > 0 && (
            <Card title="Specifications" description="Set by the category. Used for filters and comparison in the store.">
              <div className="grid gap-4 sm:grid-cols-2">
                {categoryAttributes.map((ca) => (
                  <Field key={ca.attribute_id} label={`${ca.def.label}${ca.def.unit ? ` (${ca.def.unit})` : ''}`}>
                    {ca.def.data_type === 'option' ? (
                      <Select value={attributes[ca.attribute_id] ?? ''} onChange={(e) => setAttributes((a) => ({ ...a, [ca.attribute_id]: e.target.value }))}>
                        <option value="">-</option>
                        {ca.def.options?.map((o) => <option key={o}>{o}</option>)}
                      </Select>
                    ) : ca.def.data_type === 'boolean' ? (
                      <Select value={attributes[ca.attribute_id] ?? ''} onChange={(e) => setAttributes((a) => ({ ...a, [ca.attribute_id]: e.target.value }))}>
                        <option value="">-</option><option value="true">Yes</option><option value="false">No</option>
                      </Select>
                    ) : (
                      <Input type={ca.def.data_type === 'number' ? 'number' : 'text'} value={attributes[ca.attribute_id] ?? ''}
                        onChange={(e) => setAttributes((a) => ({ ...a, [ca.attribute_id]: e.target.value }))} />
                    )}
                  </Field>
                ))}
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-5">
          <Card title="Status">
            <Select value={draft.status} onChange={(e) => set('status', e.target.value as ProductDraft['status'])}>
              <option value="draft">Draft - hidden from customers</option>
              <option value="active">Active - on sale</option>
              <option value="archived">Archived - no longer sold</option>
            </Select>
          </Card>

          <Card title="Organisation">
            <div className="space-y-4">
              <Field label="Category">
                <Select value={draft.category_id} onChange={(e) => set('category_id', e.target.value)}>
                  <option value="">None</option>
                  {lookups.data?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
              <Field label="Brand">
                <Select value={draft.brand_id} onChange={(e) => set('brand_id', e.target.value)}>
                  <option value="">None</option>
                  {lookups.data?.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </Select>
              </Field>
              <p className="text-xs text-muted">Manage the lists under <Link className="text-accent hover:underline" to="/catalogue">Categories &amp; brands</Link>.</p>
            </div>
          </Card>

          <Card title="Tax">
            <div className="space-y-3">
              <Checkbox label="Tax exempt" checked={draft.tax_exempt} onChange={(v) => set('tax_exempt', v)} />
              {!draft.tax_exempt && (
                <Field label="Rate">
                  <Select value={draft.tax_rate_id} onChange={(e) => set('tax_rate_id', e.target.value)}>
                    <option value="">Business default{(() => { const d = lookups.data?.taxRates.find((t) => t.is_default); return d ? ` (${d.name} ${d.rate_percent}%)` : ' (none set)'; })()}</option>
                    {lookups.data?.taxRates.map((t) => <option key={t.id} value={t.id}>{t.name} {t.rate_percent}%</option>)}
                  </Select>
                </Field>
              )}
            </div>
          </Card>

          {org.has('warranty') && (
            <Card title="Warranty" description="Copied onto each sale, so changing it later doesn't change what customers already bought.">
              <div className="space-y-4">
                <Field label="Months" hint="Leave empty for no warranty."><Input type="number" min="0" max="120" value={warranty.months} onChange={(e) => setWarranty({ ...warranty, months: e.target.value })} /></Field>
                <Field label="Terms"><Input value={warranty.terms} onChange={(e) => setWarranty({ ...warranty, terms: e.target.value })} placeholder="e.g. Manufacturer warranty, excludes physical damage" /></Field>
              </div>
            </Card>
          )}

          <Card title="How it's counted" description={trackingLocked ? 'Fixed now that stock has moved.' : undefined}>
            <div className="space-y-4">
              <Field label="Tracking">
                <Select value={draft.tracking_mode} disabled={trackingLocked} onChange={(e) => {
                  const mode = e.target.value as ProductDraft['tracking_mode'];
                  setDraft((d) => ({ ...d, tracking_mode: mode, allow_fractional: mode === 'serial' ? false : d.allow_fractional }));
                  if (mode !== 'non_stock') setGiftCard(false);
                }}>
                  <option value="none">Quantity only</option>
                  {(org.has('serial_tracking') || draft.tracking_mode === 'serial') && <option value="serial">Serial numbers (IMEI, serial, chassis no.)</option>}
                  {(org.has('batch_tracking') || draft.tracking_mode === 'batch') && <option value="batch">Batches with expiry</option>}
                  <option value="non_stock">Not stocked (services, fees, gift cards)</option>
                </Select>
              </Field>
              <Field label="Unit" hint="What one unit of stock is: each, kg, m, l...">
                <Input value={draft.unit_of_measure} disabled={trackingLocked} onChange={(e) => set('unit_of_measure', e.target.value)} />
              </Field>
              <Checkbox label="Sell part-units" hint="For goods sold by weight or length, e.g. 1.25 kg."
                checked={draft.allow_fractional} disabled={trackingLocked || draft.tracking_mode === 'serial'} onChange={(v) => set('allow_fractional', v)} />
              {org.has('loyalty') && draft.tracking_mode === 'non_stock' && (
                <Checkbox label="Sell as a gift card" hint="Each one sold issues a card worth its price. Gift cards carry no tax."
                  checked={giftCard} onChange={setGiftCard} />
              )}
              {draft.tracking_mode !== 'none' && (
                <Badge tone="info">{draft.tracking_mode === 'serial' ? 'Each unit is scanned in and out'
                  : draft.tracking_mode === 'batch' ? 'Sold earliest-expiry first' : 'Always available; no stock counted'}</Badge>
              )}
            </div>
          </Card>
        </div>
      </fieldset>
    </form>
  );
}

function OptionRow({ option, onChange, onRemove }: {
  option: OptionDraft; onChange: (o: OptionDraft) => void; onRemove: () => void;
}) {
  const [pending, setPending] = useState('');
  function addValue() {
    const parts = pending.split(',').map((s) => s.trim()).filter(Boolean);
    const next = [...option.values];
    for (const p of parts) if (!next.some((v) => v.toLowerCase() === p.toLowerCase())) next.push(p);
    onChange({ ...option, values: next });
    setPending('');
  }
  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addValue(); }
  }
  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex gap-2">
        <Input className="max-w-48" placeholder="Option name, e.g. Size" value={option.name} onChange={(e) => onChange({ ...option, name: e.target.value })} />
        <Input className="flex-1" placeholder="Type a value and press Enter" value={pending} onChange={(e) => setPending(e.target.value)} onKeyDown={onKey} onBlur={() => pending && addValue()} />
        <Button type="button" variant="ghost" size="sm" onClick={onRemove} aria-label="Remove option"><Trash2 className="size-4" /></Button>
      </div>
      {option.values.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {option.values.map((v) => (
            <span key={v} className="inline-flex items-center gap-1 rounded bg-surface-2 py-0.5 pl-2 pr-1 text-xs">
              {v}
              <button type="button" className="rounded p-0.5 text-muted hover:text-text" aria-label={`Remove ${v}`}
                onClick={() => onChange({ ...option, values: option.values.filter((x) => x !== v) })}><X className="size-3" /></button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
