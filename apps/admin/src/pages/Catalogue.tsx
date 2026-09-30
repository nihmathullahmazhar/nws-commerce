import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ListTree, Plus, Tag, Ruler } from 'lucide-react';
import type { Enums, Tables } from '@nws-commerce/db';
import { supabase } from '../lib/supabase';
import { unwrap } from '../lib/api';
import { useOrg } from '../lib/workspace';
import {
  Badge, Button, Card, Checkbox, Dialog, EmptyState, ErrorNote, Field, Input, PageHeader, Select, Spinner, Table, Tabs, Td, Th, useToast,
} from '@nws-commerce/ui';

type Tab = 'categories' | 'brands' | 'specs';

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export function Catalogue() {
  const [tab, setTab] = useState<Tab>('categories');
  return (
    <>
      <PageHeader title="Categories & brands" description="How products are grouped in the store and in reports." />
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'categories', label: 'Categories' }, { value: 'brands', label: 'Brands' }, { value: 'specs', label: 'Specifications' },
      ]} />
      {tab === 'categories' && <Categories />}
      {tab === 'brands' && <Brands />}
      {tab === 'specs' && <Specs />}
    </>
  );
}

// ---------------------------------------------------------------------------
function Categories() {
  const org = useOrg();
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<Partial<Tables<'categories'>> & { attribute_ids?: string[] } | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['categories-admin', org.id],
    queryFn: async () => {
      const [cats, attrs] = await Promise.all([
        supabase.from('categories').select('*, category_attributes(attribute_id)').eq('organization_id', org.id).order('position').order('name'),
        supabase.from('attribute_definitions').select('id, label').eq('organization_id', org.id).order('label'),
      ]);
      return { categories: unwrap(cats), attributes: unwrap(attrs) };
    },
  });

  const save = useMutation({
    mutationFn: async (c: NonNullable<typeof editing>) => {
      const row = {
        organization_id: org.id, name: c.name!.trim(), slug: c.slug?.trim() || slugify(c.name!),
        parent_id: c.parent_id || null, description: c.description || null, is_active: c.is_active ?? true,
      };
      const saved = unwrap(c.id
        ? await supabase.from('categories').update(row).eq('id', c.id).select('id').single()
        : await supabase.from('categories').insert(row).select('id').single());
      unwrap(await supabase.from('category_attributes').delete().eq('category_id', saved.id));
      if (c.attribute_ids?.length) {
        unwrap(await supabase.from('category_attributes').insert(
          c.attribute_ids.map((attribute_id, position) => ({ organization_id: org.id, category_id: saved.id, attribute_id, position }))));
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories-admin'] });
      qc.invalidateQueries({ queryKey: ['catalogue-lookups'] });
      setEditing(null);
      toast('Category saved');
    },
  });

  if (isLoading) return <Spinner />;
  const cats = data?.categories ?? [];
  const nameOf = (id: string | null) => cats.find((c) => c.id === id)?.name;

  return (
    <Card padded={false} title="Categories" description="Nest categories to build the store's menu. A category can list the specifications its products share."
      actions={<Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setEditing({ name: '', is_active: true, attribute_ids: [] })}>Add category</Button>}>
      <ErrorNote error={error} />
      {cats.length === 0 ? (
        <EmptyState icon={<ListTree className="size-5" />} title="No categories yet">
          Categories group products for browsing and reporting, e.g. Menswear › Shirts, or Pantry › Rice &amp; grains.
        </EmptyState>
      ) : (
        <Table>
          <thead><tr><Th>Name</Th><Th>Parent</Th><Th>Specifications</Th><Th>Status</Th><Th /></tr></thead>
          <tbody>
            {cats.map((c) => (
              <tr key={c.id}>
                <Td className="font-medium">{c.name}</Td>
                <Td className="text-muted">{nameOf(c.parent_id) ?? '-'}</Td>
                <Td className="text-muted">{c.category_attributes.length || '-'}</Td>
                <Td>{c.is_active ? <Badge tone="ok">Visible</Badge> : <Badge>Hidden</Badge>}</Td>
                <Td align="right"><Button size="sm" variant="ghost" onClick={() => setEditing({ ...c, attribute_ids: c.category_attributes.map((a) => a.attribute_id) })}>Edit</Button></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Dialog open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Edit category' : 'New category'}
        footer={<><Button onClick={() => setEditing(null)}>Cancel</Button><Button variant="primary" busy={save.isPending} form="category-form" type="submit">Save</Button></>}>
        {editing && (
          <form id="category-form" className="space-y-4" onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate(editing); }}>
            <ErrorNote error={save.error} />
            <Field label="Name"><Input required value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
            <Field label="Parent category">
              <Select value={editing.parent_id ?? ''} onChange={(e) => setEditing({ ...editing, parent_id: e.target.value || null })}>
                <option value="">None (top level)</option>
                {cats.filter((c) => c.id !== editing.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            {(data?.attributes.length ?? 0) > 0 && (
              <fieldset>
                <legend className="mb-2 text-[13px] font-medium">Specifications products in this category have</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {data!.attributes.map((a) => (
                    <Checkbox key={a.id} label={a.label} checked={editing.attribute_ids?.includes(a.id) ?? false}
                      onChange={(on) => setEditing({ ...editing, attribute_ids: on ? [...(editing.attribute_ids ?? []), a.id] : (editing.attribute_ids ?? []).filter((x) => x !== a.id) })} />
                  ))}
                </div>
              </fieldset>
            )}
            <Checkbox label="Visible in the store" checked={editing.is_active ?? true} onChange={(v) => setEditing({ ...editing, is_active: v })} />
          </form>
        )}
      </Dialog>
    </Card>
  );
}

// ---------------------------------------------------------------------------
function Brands() {
  const org = useOrg();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['brands-admin', org.id],
    queryFn: async () => unwrap(await supabase.from('brands').select('*').eq('organization_id', org.id).order('name')),
  });
  const add = useMutation({
    mutationFn: async () => unwrap(await supabase.from('brands').insert({ organization_id: org.id, name: name.trim(), slug: slugify(name) })),
    onSuccess: () => { setName(''); qc.invalidateQueries({ queryKey: ['brands-admin'] }); qc.invalidateQueries({ queryKey: ['catalogue-lookups'] }); toast('Brand added'); },
  });
  const toggle = useMutation({
    mutationFn: async (b: Tables<'brands'>) => unwrap(await supabase.from('brands').update({ is_active: !b.is_active }).eq('id', b.id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['brands-admin'] }),
  });

  return (
    <Card padded={false} title="Brands">
      <form className="flex gap-2 border-b border-border p-3" onSubmit={(e) => { e.preventDefault(); if (name.trim()) add.mutate(); }}>
        <Input placeholder="Brand name" value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" busy={add.isPending} icon={<Plus className="size-3.5" />}>Add</Button>
      </form>
      <div className="px-3 pt-3 empty:hidden"><ErrorNote error={error ?? add.error} /></div>
      {isLoading ? <Spinner /> : !data?.length ? (
        <EmptyState icon={<Tag className="size-5" />} title="No brands yet">Brands let shoppers browse and filter by maker.</EmptyState>
      ) : (
        <Table>
          <thead><tr><Th>Brand</Th><Th>Status</Th><Th /></tr></thead>
          <tbody>
            {data.map((b) => (
              <tr key={b.id}>
                <Td className="font-medium">{b.name}</Td>
                <Td>{b.is_active ? <Badge tone="ok">Visible</Badge> : <Badge>Hidden</Badge>}</Td>
                <Td align="right"><Button size="sm" variant="ghost" onClick={() => toggle.mutate(b)}>{b.is_active ? 'Hide' : 'Show'}</Button></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
function Specs() {
  const org = useOrg();
  const qc = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState({ label: '', data_type: 'text' as Enums['attribute_type'], unit: '', options: '', is_filterable: true });

  const { data, isLoading, error } = useQuery({
    queryKey: ['attributes-admin', org.id],
    queryFn: async () => unwrap(await supabase.from('attribute_definitions').select('*').eq('organization_id', org.id).order('label')),
  });
  const add = useMutation({
    mutationFn: async () => {
      const options = draft.data_type === 'option' ? draft.options.split(',').map((s) => s.trim()).filter(Boolean) : null;
      return unwrap(await supabase.from('attribute_definitions').insert({
        organization_id: org.id, label: draft.label.trim(), code: slugify(draft.label).replace(/-/g, '_').replace(/^(\d)/, 'a_$1'),
        data_type: draft.data_type, unit: draft.unit.trim() || null, options, is_filterable: draft.is_filterable,
      }));
    },
    onSuccess: () => {
      setDraft({ label: '', data_type: 'text', unit: '', options: '', is_filterable: true });
      qc.invalidateQueries({ queryKey: ['attributes-admin'] });
      qc.invalidateQueries({ queryKey: ['categories-admin'] });
      toast('Specification added');
    },
  });

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card title="Add a specification" className="lg:order-2">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
          <ErrorNote error={add.error} />
          <Field label="Name"><Input required placeholder="e.g. Material, Screen size, Pack size" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} /></Field>
          <Field label="Type">
            <Select value={draft.data_type} onChange={(e) => setDraft({ ...draft, data_type: e.target.value as Enums['attribute_type'] })}>
              <option value="text">Text</option><option value="number">Number</option><option value="boolean">Yes / no</option><option value="option">Pick from a list</option>
            </Select>
          </Field>
          {draft.data_type === 'number' && <Field label="Unit"><Input placeholder="e.g. inches, g, mAh" value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} /></Field>}
          {draft.data_type === 'option' && <Field label="Choices" hint="Separate with commas."><Input required value={draft.options} onChange={(e) => setDraft({ ...draft, options: e.target.value })} /></Field>}
          <Checkbox label="Shoppers can filter by it" checked={draft.is_filterable} onChange={(v) => setDraft({ ...draft, is_filterable: v })} />
          <Button type="submit" variant="primary" busy={add.isPending}>Add specification</Button>
        </form>
      </Card>
      <Card padded={false} title="Specifications" className="lg:col-span-2"
        description="Structured facts about products. Attach them to categories, then fill them in on each product.">
        <ErrorNote error={error} />
        {isLoading ? <Spinner /> : !data?.length ? (
          <EmptyState icon={<Ruler className="size-5" />} title="No specifications yet">
            A fashion store might track Material and Fit; a phone shop Storage and Screen size; a grocer Pack size.
          </EmptyState>
        ) : (
          <Table>
            <thead><tr><Th>Name</Th><Th>Type</Th><Th>Filter</Th></tr></thead>
            <tbody>
              {data.map((a) => (
                <tr key={a.id}>
                  <Td className="font-medium">{a.label}{a.unit && <span className="text-muted"> ({a.unit})</span>}</Td>
                  <Td className="text-muted">{a.data_type === 'option' ? a.options?.join(', ') : a.data_type}</Td>
                  <Td>{a.is_filterable ? <Badge tone="accent">Filterable</Badge> : '-'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
