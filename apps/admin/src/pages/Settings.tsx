import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Minus, Plus } from 'lucide-react';
import type { Enums, Json, Tables } from '@nws-commerce/db';
import { supabase } from '../lib/supabase';
import { unwrap } from '../lib/api';
import { useOrg } from '../lib/workspace';
import { date, dateTime, money } from '../lib/format';
import type { ShiftSummary } from '@nws-commerce/db';
import { ShiftReportView } from '../components/ShiftReportView';
import {
  Badge, Button, Card, Checkbox, Dialog, EmptyState, ErrorNote, Field, Input, PageHeader, Select, Spinner, Table, Tabs, Td, Th, useToast,
} from '@nws-commerce/ui';

type Tab = 'business' | 'tax' | 'locations' | 'tills' | 'staff' | 'features';

export function SettingsPage() {
  const org = useOrg();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) ?? 'business';
  return (
    <>
      <PageHeader title="Settings" />
      <Tabs value={tab} onChange={(t) => setParams({ tab: t }, { replace: true })} tabs={[
        { value: 'business', label: 'Business' }, { value: 'tax', label: 'Tax' }, { value: 'locations', label: 'Locations' },
        ...(org.has('pos') ? [{ value: 'tills' as const, label: 'Tills' }] : []),
        { value: 'staff', label: 'Staff' }, { value: 'features', label: 'Features' },
      ]} />
      {tab === 'business' && <Business />}
      {tab === 'tax' && <Tax />}
      {tab === 'locations' && <Locations />}
      {tab === 'tills' && org.has('pos') && <Tills />}
      {tab === 'staff' && <Staff />}
      {tab === 'features' && <Features />}
    </>
  );
}

const ROLES: Enums['staff_role'][] = ['admin', 'manager', 'cashier', 'stock_keeper', 'viewer'];
const ROLE_HELP: Record<Enums['staff_role'], string> = {
  owner: 'Everything, including staff and settings.',
  admin: 'Everything, including staff and settings.',
  manager: 'Catalogue, stock, orders, refunds, customers, reports and discount approvals.',
  cashier: 'Sells at the counter and looks after customers.',
  stock_keeper: 'Receives and adjusts stock.',
  viewer: 'Read-only: orders, stock and reports.',
};
const roleName = (r: string) => r.replace('_', ' ').replace(/^\w/, (c) => c.toUpperCase());

// ---------------------------------------------------------------------------
function Business() {
  const org = useOrg();
  const qc = useQueryClient();
  const toast = useToast();
  const s = org.settings as Record<string, unknown>;
  const limits = (s.discount_limits as Record<string, number> | undefined) ?? {};
  const [name, setName] = useState(org.name);
  const [inclusive, setInclusive] = useState(org.pricesIncludeTax);
  const [hold, setHold] = useState(String(s.checkout_hold_minutes ?? 15));
  const [maxLine, setMaxLine] = useState(String(s.checkout_max_line_quantity ?? 20));
  const [lowDefault, setLowDefault] = useState(String(s.low_stock_default ?? 3));
  const [footer, setFooter] = useState(String(s.receipt_footer ?? ''));
  const [returnDays, setReturnDays] = useState(s.return_days == null ? '' : String(s.return_days));
  const [loyalty, setLoyalty] = useState({
    per100: String(s.loyalty_points_per_100 ?? 1), value: String(s.loyalty_point_value ?? 1), min: String(s.loyalty_min_redeem ?? 0),
  });
  const [store, setStore] = useState({
    delivery_enabled: s.delivery_enabled !== false, pickup_enabled: s.pickup_enabled !== false,
    delivery_fee: String(s.delivery_fee ?? 0), free_delivery_over: s.free_delivery_over == null ? '' : String(s.free_delivery_over),
    allow_cash_on_delivery: s.allow_cash_on_delivery !== false, bank_transfer_details: String(s.bank_transfer_details ?? ''),
    bank_transfer_hold_hours: String(s.bank_transfer_hold_hours ?? 24),
    contact_phone: String(s.contact_phone ?? ''), contact_email: String(s.contact_email ?? ''),
  });
  const [discounts, setDiscounts] = useState<Record<string, string>>({
    manager: String(limits.manager ?? 50), cashier: String(limits.cashier ?? 0),
  });

  const save = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('update_organization_settings', {
      p_organization_id: org.id,
      p_changes: {
        name, prices_include_tax: inclusive,
        settings: {
          checkout_hold_minutes: Number(hold), checkout_max_line_quantity: Number(maxLine),
          low_stock_default: Number(lowDefault), receipt_footer: footer,
          ...(org.has('returns') ? { return_days: returnDays === '' ? null : Number(returnDays) } : {}),
          ...(org.has('loyalty') ? {
            loyalty_points_per_100: Number(loyalty.per100 || 0), loyalty_point_value: Number(loyalty.value || 0),
            loyalty_min_redeem: Number(loyalty.min || 0),
          } : {}),
          discount_limits: { ...limits, manager: Number(discounts.manager), cashier: Number(discounts.cashier) },
          ...(org.has('storefront') ? {
            delivery_enabled: store.delivery_enabled, pickup_enabled: store.pickup_enabled,
            delivery_fee: Number(store.delivery_fee || 0),
            free_delivery_over: store.free_delivery_over === '' ? null : Number(store.free_delivery_over),
            allow_cash_on_delivery: store.allow_cash_on_delivery,
            bank_transfer_details: store.bank_transfer_details.trim() || null,
            bank_transfer_hold_hours: Number(store.bank_transfer_hold_hours || 24),
            contact_phone: store.contact_phone.trim() || null, contact_email: store.contact_email.trim() || null,
          } : {}),
        },
      } as unknown as Json,
    })),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['workspaces'] }); toast('Settings saved'); },
  });

  return (
    <form className="grid gap-5 lg:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <div className="space-y-5">
        <Card title="Business">
          <div className="space-y-4">
            <Field label="Business name"><Input required value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Currency" hint="Set when the business is created."><Input value={org.currency} disabled /></Field>
            <Checkbox label="Shelf prices include tax" hint="Usual for retail. Turn off to add tax on top of prices (common for trade customers)."
              checked={inclusive} onChange={setInclusive} />
            <Field label="Receipt footer"><Input value={footer} onChange={(e) => setFooter(e.target.value)} placeholder="e.g. Exchanges within 7 days with receipt" /></Field>
          </div>
        </Card>
        {org.has('returns') && (
          <Card title="Returns">
            <Field label="Return period (days)" hint="Cashiers can take returns within this many days of the sale; after that, a manager must. Empty means no limit.">
              <Input type="number" min="0" max="365" value={returnDays} onChange={(e) => setReturnDays(e.target.value)} />
            </Field>
          </Card>
        )}
        {org.has('loyalty') && (
          <Card title="Loyalty points" description="Customers earn on what they pay (not delivery, gift cards or points), at the till and online, and spend points at the till.">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={`Points per ${org.currency} 100`} hint="0 stops earning."><Input type="number" min="0" step="0.1" value={loyalty.per100} onChange={(e) => setLoyalty({ ...loyalty, per100: e.target.value })} /></Field>
              <Field label={`One point is worth (${org.currency})`}><Input type="number" min="0" step="0.01" value={loyalty.value} onChange={(e) => setLoyalty({ ...loyalty, value: e.target.value })} /></Field>
              <Field label="Fewest points to spend"><Input type="number" min="0" value={loyalty.min} onChange={(e) => setLoyalty({ ...loyalty, min: e.target.value })} /></Field>
            </div>
            <p className="mt-3 text-xs text-muted">
              Spending {org.currency} 10,000 earns {Math.floor(100 * Number(loyalty.per100 || 0))} points, worth {org.currency} {(Math.floor(100 * Number(loyalty.per100 || 0)) * Number(loyalty.value || 0)).toLocaleString()} back
              {' '}({((Number(loyalty.per100 || 0) * Number(loyalty.value || 0))).toFixed(1)}% return).
            </p>
          </Card>
        )}
        <Card title="Stock">
          <Field label="Default low-stock level" hint="Items with no level of their own are flagged at or below this."><Input type="number" min="0" value={lowDefault} onChange={(e) => setLowDefault(e.target.value)} /></Field>
        </Card>
      </div>
      <div className="space-y-5">
        {org.has('storefront') && (
          <Card title="Online store" description="What shoppers can choose at checkout.">
            <div className="space-y-4">
              <Checkbox label="Deliver orders" checked={store.delivery_enabled} onChange={(v) => setStore({ ...store, delivery_enabled: v })} />
              {store.delivery_enabled && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Delivery fee"><Input type="number" min="0" step="0.01" value={store.delivery_fee} onChange={(e) => setStore({ ...store, delivery_fee: e.target.value })} /></Field>
                  <Field label="Free delivery over" hint="Leave empty for never."><Input type="number" min="0" step="0.01" value={store.free_delivery_over} onChange={(e) => setStore({ ...store, free_delivery_over: e.target.value })} /></Field>
                </div>
              )}
              <Checkbox label="Collect in store" hint="From locations that fulfil online orders." checked={store.pickup_enabled} onChange={(v) => setStore({ ...store, pickup_enabled: v })} />
              <Checkbox label="Pay on delivery / collection" checked={store.allow_cash_on_delivery} onChange={(v) => setStore({ ...store, allow_cash_on_delivery: v })} />
              <Field label="Bank transfer details" hint="Shown to shoppers who choose bank transfer. Leave empty to turn bank transfer off.">
                <textarea className="min-h-20 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm" value={store.bank_transfer_details}
                  onChange={(e) => setStore({ ...store, bank_transfer_details: e.target.value })} placeholder={'Bank, account number\nAccount name'} />
              </Field>
              {store.bank_transfer_details.trim() && <Field label="Hold stock for a transfer (hours)" hint="1-168."><Input type="number" min="1" max="168" value={store.bank_transfer_hold_hours} onChange={(e) => setStore({ ...store, bank_transfer_hold_hours: e.target.value })} /></Field>}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Contact phone"><Input value={store.contact_phone} onChange={(e) => setStore({ ...store, contact_phone: e.target.value })} /></Field>
                <Field label="Contact email"><Input type="email" value={store.contact_email} onChange={(e) => setStore({ ...store, contact_email: e.target.value })} /></Field>
              </div>
            </div>
          </Card>
        )}
        <Card title="Online checkout">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Hold stock for (minutes)" hint="While the shopper pays. 1-120."><Input type="number" min="1" max="120" value={hold} onChange={(e) => setHold(e.target.value)} /></Field>
            <Field label="Most of one item per order" hint="Stops one shopper holding all the stock."><Input type="number" min="1" value={maxLine} onChange={(e) => setMaxLine(e.target.value)} /></Field>
          </div>
        </Card>
        <Card title="Discount limits" description="The largest discount, as a % of the sale, each role can give without a manager's PIN. Owners and admins have no limit.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Managers (%)"><Input type="number" min="0" max="100" value={discounts.manager} onChange={(e) => setDiscounts({ ...discounts, manager: e.target.value })} /></Field>
            <Field label="Cashiers (%)"><Input type="number" min="0" max="100" value={discounts.cashier} onChange={(e) => setDiscounts({ ...discounts, cashier: e.target.value })} /></Field>
          </div>
        </Card>
        <ErrorNote error={save.error} />
        <div className="flex justify-end"><Button type="submit" variant="primary" busy={save.isPending}>Save settings</Button></div>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
function Tax() {
  const org = useOrg();
  const qc = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState({ name: '', code: '', rate: '' });

  const { data, isLoading, error } = useQuery({
    queryKey: ['tax-rates', org.id],
    queryFn: async () => unwrap(await supabase.from('tax_rates').select('*').eq('organization_id', org.id).order('rate_percent', { ascending: false })),
  });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['tax-rates'] }); qc.invalidateQueries({ queryKey: ['catalogue-lookups'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); };

  const add = useMutation({
    mutationFn: async () => unwrap(await supabase.from('tax_rates').insert({
      organization_id: org.id, name: draft.name.trim(), code: (draft.code || draft.name).trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 16),
      rate_percent: Number(draft.rate), is_default: !(data ?? []).some((t) => t.is_default),
    })),
    onSuccess: () => { setDraft({ name: '', code: '', rate: '' }); refresh(); toast('Tax rate added'); },
  });
  const makeDefault = useMutation({
    mutationFn: async (t: Tables<'tax_rates'>) => {
      unwrap(await supabase.from('tax_rates').update({ is_default: false }).eq('organization_id', org.id).eq('is_default', true));
      unwrap(await supabase.from('tax_rates').update({ is_default: true }).eq('id', t.id));
    },
    onSuccess: () => { refresh(); toast('Default tax rate changed'); },
  });

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card padded={false} title="Tax rates" className="lg:col-span-2" description="Products use the default unless they name another rate or are exempt. Tax is worked out per line, after discounts.">
        <ErrorNote error={error ?? makeDefault.error} />
        {isLoading ? <Spinner /> : !data?.length ? (
          <EmptyState title="No tax rates yet">Add your VAT rate. Until then, sales carry no tax.</EmptyState>
        ) : (
          <Table>
            <thead><tr><Th>Name</Th><Th>Code</Th><Th align="right">Rate</Th><Th /></tr></thead>
            <tbody>
              {data.map((t) => (
                <tr key={t.id}>
                  <Td className="font-medium">{t.name}</Td>
                  <Td className="font-mono text-xs text-muted">{t.code}</Td>
                  <Td align="right">{t.rate_percent}%</Td>
                  <Td align="right">{t.is_default ? <Badge tone="accent">Default</Badge> : <Button size="sm" variant="ghost" onClick={() => makeDefault.mutate(t)}>Make default</Button>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Card title="Add a rate">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
          <ErrorNote error={add.error} />
          <Field label="Name"><Input required placeholder="e.g. VAT" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
          <Field label="Rate (%)"><Input required type="number" min="0" max="100" step="0.001" value={draft.rate} onChange={(e) => setDraft({ ...draft, rate: e.target.value })} /></Field>
          <Button type="submit" variant="primary" busy={add.isPending}>Add rate</Button>
        </form>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
function Locations() {
  const org = useOrg();
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<Partial<Tables<'locations'>> | null>(null);
  const multi = org.has('multi_location');

  const save = useMutation({
    mutationFn: async (l: Partial<Tables<'locations'>>) => {
      const row = {
        name: l.name!.trim(), code: (l.code ?? '').trim().toUpperCase(), kind: l.kind ?? 'store',
        sells_online: l.sells_online ?? false, fulfilment_priority: l.fulfilment_priority ?? 100,
        phone: l.phone || null, is_active: l.is_active ?? true, address: (l.address ?? {}) as Json,
      };
      return l.id
        ? unwrap(await supabase.from('locations').update(row).eq('id', l.id))
        : unwrap(await supabase.from('locations').insert({ ...row, organization_id: org.id }));
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['locations'] }); setEditing(null); toast('Location saved'); },
  });

  const address = (editing?.address ?? {}) as Record<string, string>;
  return (
    <Card padded={false} title="Locations" description={multi ? 'Shops and warehouses. Each holds its own stock.' : 'Your plan includes one location. Multi-location adds branches and warehouses.'}
      actions={org.can('locations.manage') && multi && <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setEditing({ kind: 'store', is_active: true, sells_online: false, fulfilment_priority: 50 })}>Add location</Button>}>
      <Table>
        <thead><tr><Th>Location</Th><Th>Type</Th><Th>Online orders</Th><Th>Status</Th><Th /></tr></thead>
        <tbody>
          {org.locations.map((l) => (
            <tr key={l.id}>
              <Td><div className="font-medium">{l.name}</div><div className="font-mono text-xs text-muted">{l.code}</div></Td>
              <Td className="capitalize text-muted">{l.kind}</Td>
              <Td>{l.sells_online ? <span className="text-sm">Fulfils · priority {l.fulfilment_priority}</span> : <span className="text-muted">-</span>}</Td>
              <Td>{l.is_active ? <Badge tone="ok">Open</Badge> : <Badge>Closed</Badge>}</Td>
              <Td align="right">{org.can('locations.manage') && <Button size="sm" variant="ghost" onClick={() => setEditing(l)}>Edit</Button>}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Dialog open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Edit location' : 'New location'}
        footer={<><Button onClick={() => setEditing(null)}>Cancel</Button><Button variant="primary" busy={save.isPending} form="location-form" type="submit">Save</Button></>}>
        {editing && (
          <form id="location-form" className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(editing); }}>
            <ErrorNote error={save.error} />
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Name" className="sm:col-span-2"><Input required value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
              <Field label="Code" hint="Short, e.g. KANDY"><Input required pattern="[A-Za-z0-9_-]{1,16}" value={editing.code ?? ''} onChange={(e) => setEditing({ ...editing, code: e.target.value })} /></Field>
            </div>
            <Field label="Type">
              <Select value={editing.kind ?? 'store'} onChange={(e) => setEditing({ ...editing, kind: e.target.value as Enums['location_kind'] })}>
                <option value="store">Shop</option><option value="warehouse">Warehouse</option>
              </Select>
            </Field>
            <Field label="Address"><Input value={address.line1 ?? ''} onChange={(e) => setEditing({ ...editing, address: { ...address, line1: e.target.value } })} /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="City"><Input value={address.city ?? ''} onChange={(e) => setEditing({ ...editing, address: { ...address, city: e.target.value } })} /></Field>
              <Field label="Phone"><Input value={editing.phone ?? ''} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} /></Field>
            </div>
            <Checkbox label="Fulfils online orders" hint="Its stock counts towards what the online store can sell." checked={editing.sells_online ?? false} onChange={(v) => setEditing({ ...editing, sells_online: v })} />
            {editing.sells_online && <Field label="Fulfilment priority" hint="Lower is tried first."><Input type="number" min="0" value={editing.fulfilment_priority ?? 100} onChange={(e) => setEditing({ ...editing, fulfilment_priority: Number(e.target.value) })} /></Field>}
            {editing.id && <Checkbox label="Open" checked={editing.is_active ?? true} onChange={(v) => setEditing({ ...editing, is_active: v })} />}
          </form>
        )}
      </Dialog>
    </Card>
  );
}

// ---------------------------------------------------------------------------
function Staff() {
  const org = useOrg();
  const qc = useQueryClient();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Enums['staff_role']>('cashier');
  const [pin, setPin] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['staff', org.id],
    enabled: org.can('staff.manage'),
    queryFn: async () => unwrap(await supabase.rpc('list_staff', { p_organization_id: org.id })),
  });
  const add = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('add_staff_by_email', { p_organization_id: org.id, p_email: email, p_role: role })),
    onSuccess: () => { setEmail(''); qc.invalidateQueries({ queryKey: ['staff'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); toast('Staff member added'); },
  });
  const update = useMutation({
    mutationFn: async (m: { user_id: string; role: Enums['staff_role']; location_ids: string[] | null; is_active: boolean }) =>
      unwrap(await supabase.rpc('upsert_staff_member', {
        p_organization_id: org.id, p_user_id: m.user_id, p_role: m.role, p_location_ids: m.location_ids, p_is_active: m.is_active,
      })),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['staff'] }); toast('Staff member updated'); },
  });
  const savePin = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('set_my_pin', { p_organization_id: org.id, p_pin: pin })),
    onSuccess: () => { setPin(''); qc.invalidateQueries({ queryKey: ['staff'] }); toast('Your PIN is set'); },
  });

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="space-y-5 lg:col-span-2">
        {org.can('staff.manage') ? (
          <Card padded={false} title="Staff" description="Each person signs in with their own account. Roles decide what they can do; the database enforces it.">
            <form className="flex flex-wrap gap-2 border-b border-border p-3" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
              <Input className="min-w-56 flex-1" type="email" required placeholder="Their account email" value={email} onChange={(e) => setEmail(e.target.value)} />
              <Select className="w-40" value={role} onChange={(e) => setRole(e.target.value as Enums['staff_role'])}>
                {ROLES.map((r) => <option key={r} value={r}>{roleName(r)}</option>)}
              </Select>
              <Button type="submit" busy={add.isPending} icon={<Plus className="size-3.5" />}>Add</Button>
            </form>
            <div className="px-3 pt-3 empty:hidden"><ErrorNote error={add.error ?? update.error ?? error} /></div>
            {isLoading ? <Spinner /> : (
              <Table>
                <thead><tr><Th>Person</Th><Th>Role</Th><Th>Locations</Th><Th>PIN</Th><Th /></tr></thead>
                <tbody>
                  {data?.map((m) => {
                    const locked = m.role === 'owner';
                    return (
                      <tr key={m.user_id} className={m.is_active ? '' : 'opacity-60'}>
                        <Td><div className="font-medium">{m.email}</div><div className="text-xs text-muted">since {date(m.created_at)}</div></Td>
                        <Td>
                          {locked ? <Badge tone="accent">Owner</Badge> : (
                            <Select className="h-8 w-36" value={m.role ?? 'viewer'} title={ROLE_HELP[m.role ?? 'viewer']}
                              onChange={(e) => update.mutate({ user_id: m.user_id!, role: e.target.value as Enums['staff_role'], location_ids: m.location_ids, is_active: !!m.is_active })}>
                              {ROLES.map((r) => <option key={r} value={r}>{roleName(r)}</option>)}
                            </Select>
                          )}
                        </Td>
                        <Td>
                          {locked || org.locations.length < 2 ? <span className="text-muted">All</span> : (
                            <Select className="h-8 w-40" value={m.location_ids?.[0] ?? ''}
                              onChange={(e) => update.mutate({ user_id: m.user_id!, role: m.role!, location_ids: e.target.value ? [e.target.value] : null, is_active: !!m.is_active })}>
                              <option value="">All locations</option>
                              {org.locations.map((l) => <option key={l.id} value={l.id}>{l.name} only</option>)}
                            </Select>
                          )}
                        </Td>
                        <Td>{m.has_pin ? <Check className="size-4 text-ok" aria-label="PIN set" /> : <Minus className="size-4 text-faint" aria-label="No PIN" />}</Td>
                        <Td align="right">
                          {!locked && <Button size="sm" variant="ghost" onClick={() => update.mutate({ user_id: m.user_id!, role: m.role!, location_ids: m.location_ids, is_active: !m.is_active })}>
                            {m.is_active ? 'Deactivate' : 'Reactivate'}</Button>}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
            <p className="border-t border-border px-4 py-2.5 text-xs text-muted">
              Adding staff needs an existing account for their email. Email invitations arrive with the hosted Supabase project.
            </p>
          </Card>
        ) : <Card title="Staff"><p className="text-sm text-muted">Only owners and admins manage staff.</p></Card>}
      </div>
      <Card title="Your approval PIN" description="Managers use a PIN to approve discounts beyond a cashier's limit at the till. Five wrong tries lock it for 15 minutes.">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); savePin.mutate(); }}>
          <ErrorNote error={savePin.error} />
          <Field label="New PIN" hint="4 to 8 digits."><Input type="password" inputMode="numeric" autoComplete="new-password" pattern="[0-9]{4,8}" required value={pin} onChange={(e) => setPin(e.target.value)} /></Field>
          <Button type="submit" busy={savePin.isPending}>Set PIN</Button>
        </form>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
const MODULES: { key: Enums['module_key']; name: string; body: string }[] = [
  { key: 'storefront', name: 'Online store', body: 'Sell on your website with live stock and checkout holds.' },
  { key: 'pos', name: 'Point of sale', body: 'Counter sales from the same stock, with split payments and receipts.' },
  { key: 'multi_location', name: 'Multiple locations', body: 'Branches and warehouses, each with its own stock.' },
  { key: 'transfers', name: 'Stock transfers', body: 'Move stock between locations with a full trail.' },
  { key: 'purchasing', name: 'Purchasing', body: 'Suppliers, purchase orders and goods receiving.' },
  { key: 'returns', name: 'Returns', body: 'Customer returns with inspection before stock goes back on sale.' },
  { key: 'promotions', name: 'Promotions', body: 'Automatic offers and coupon codes.' },
  { key: 'loyalty', name: 'Loyalty', body: 'Points and rewards across every channel.' },
  { key: 'reviews', name: 'Reviews', body: 'Verified-buyer product reviews.' },
  { key: 'wholesale', name: 'Wholesale', body: 'Trade price lists and trade accounts.' },
  { key: 'mobile_app', name: 'Mobile app', body: 'Your own customer app on the same backend.' },
  { key: 'serial_tracking', name: 'Serial numbers', body: 'Track each unit by IMEI or serial number, from delivery to sale and warranty.' },
  { key: 'batch_tracking', name: 'Batches & expiry', body: 'Lots with expiry dates, sold earliest-expiry first.' },
  { key: 'warranty', name: 'Warranty', body: 'Warranty periods, lookups and claims.' },
];

function Features() {
  const org = useOrg();
  const plan = String((org.settings as Record<string, unknown>).plan ?? '');
  return (
    <Card padded={false} title="Features" description={`Your plan: ${plan ? roleName(plan) : 'custom'}. Features are switched on by NWS; contact us to add one.`}>
      <ul className="divide-y divide-border">
        {MODULES.map((m) => {
          const on = org.has(m.key);
          return (
            <li key={m.key} className="flex items-start justify-between gap-4 px-4 py-3">
              <div><div className="text-sm font-medium">{m.name}</div><div className="text-sm text-muted">{m.body}</div></div>
              {on ? <Badge tone="ok">On</Badge> : <Badge>Off</Badge>}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// ---------------------------------------------------------------------------
function Tills() {
  const org = useOrg();
  const qc = useQueryClient();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: '', code: '', location_id: org.locations[0]?.id ?? '' });
  const [report, setReport] = useState<ShiftSummary | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['tills', org.id],
    queryFn: async () => {
      const [tills, shifts] = await Promise.all([
        supabase.from('pos_terminals').select('*, locations(name)').eq('organization_id', org.id).order('code'),
        supabase.from('pos_shifts').select('id, number, terminal_id, status, opened_at, closed_at, opening_float, expected_cash, counted_cash, variance')
          .eq('organization_id', org.id).order('opened_at', { ascending: false }).limit(30),
      ]);
      return { tills: unwrap(tills), shifts: unwrap(shifts) };
    },
  });
  const add = useMutation({
    mutationFn: async () => unwrap(await supabase.from('pos_terminals').insert({
      organization_id: org.id, location_id: draft.location_id, name: draft.name.trim(), code: draft.code.trim().toUpperCase(),
    })),
    onSuccess: () => { setAdding(false); setDraft({ ...draft, name: '', code: '' }); qc.invalidateQueries({ queryKey: ['tills'] }); toast('Till added'); },
  });
  const toggle = useMutation({
    mutationFn: async (t: { id: string; is_active: boolean }) => unwrap(await supabase.from('pos_terminals').update({ is_active: !t.is_active }).eq('id', t.id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tills'] }),
  });
  const openReport = async (id: string) => setReport(unwrap(await supabase.rpc('pos_shift_summary', { p_shift_id: id })) as unknown as ShiftSummary);

  if (isLoading) return <Spinner />;
  const tillName = (id: string) => data?.tills.find((t) => t.id === id)?.name ?? '';
  return (
    <div className="space-y-5">
      <Card padded={false} title="Tills" description="Each counter that sells. Cashiers open a shift on a till with a counted float."
        actions={org.can('locations.manage') && <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setAdding(true)}>Add till</Button>}>
        <ErrorNote error={error ?? toggle.error} />
        {!data?.tills.length ? <EmptyState title="No tills yet">Add a till for each counter, then cashiers sign in to the POS app and open a shift on it.</EmptyState> : (
          <Table>
            <thead><tr><Th>Till</Th><Th>Location</Th><Th>Now</Th><Th /></tr></thead>
            <tbody>
              {data.tills.map((t) => {
                const open = data.shifts.find((s) => s.terminal_id === t.id && s.status === 'open');
                return (
                  <tr key={t.id} className={t.is_active ? '' : 'opacity-60'}>
                    <Td><div className="font-medium">{t.name}</div><div className="font-mono text-xs text-muted">{t.code}</div></Td>
                    <Td className="text-muted">{t.locations?.name}</Td>
                    <Td>{open ? <button className="text-sm text-accent hover:underline" onClick={() => openReport(open.id)}>{open.number} open since {dateTime(open.opened_at)}</button> : <span className="text-muted">No shift open</span>}</Td>
                    <Td align="right">{org.can('locations.manage') && <Button size="sm" variant="ghost" onClick={() => toggle.mutate(t)}>{t.is_active ? 'Retire' : 'Bring back'}</Button>}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      {org.can('reports.view') && (data?.shifts.length ?? 0) > 0 && (
        <Card padded={false} title="Recent shifts" description="Expected cash is the float plus cash taken, plus paid in, less paid out and drops.">
          <Table>
            <thead><tr><Th>Shift</Th><Th>Till</Th><Th>Opened</Th><Th align="right">Expected</Th><Th align="right">Counted</Th><Th align="right">Over / short</Th></tr></thead>
            <tbody>
              {data!.shifts.map((s) => (
                <tr key={s.id} className="hover:bg-surface-2/60">
                  <Td><button className="font-medium hover:text-accent" onClick={() => openReport(s.id)}>{s.number}</button> {s.status === 'open' && <Badge tone="info">Open</Badge>}</Td>
                  <Td className="text-muted">{tillName(s.terminal_id)}</Td>
                  <Td className="text-muted">{dateTime(s.opened_at)}</Td>
                  <Td align="right">{s.expected_cash === null ? '-' : money(s.expected_cash, org.currency)}</Td>
                  <Td align="right">{s.counted_cash === null ? '-' : money(s.counted_cash, org.currency)}</Td>
                  <Td align="right" className={s.variance ? 'text-danger' : s.variance === 0 ? 'text-ok' : ''}>{s.variance === null ? '-' : s.variance === 0 ? 'Balanced' : money(s.variance, org.currency)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      <Dialog open={adding} onClose={() => setAdding(false)} title="Add a till"
        footer={<><Button onClick={() => setAdding(false)}>Cancel</Button><Button variant="primary" busy={add.isPending} form="till-form" type="submit">Add till</Button></>}>
        <form id="till-form" className="space-y-4" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
          <ErrorNote error={add.error} />
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Name" className="sm:col-span-2"><Input required placeholder="e.g. Front counter" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
            <Field label="Code"><Input required pattern="[A-Za-z0-9_-]{1,16}" placeholder="TILL1" value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} /></Field>
          </div>
          <Field label="Location">
            <Select value={draft.location_id} onChange={(e) => setDraft({ ...draft, location_id: e.target.value })}>
              {org.locations.filter((l) => l.is_active).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          </Field>
        </form>
      </Dialog>
      <Dialog open={!!report} onClose={() => setReport(null)} title={report?.status === 'open' ? 'Shift so far (X report)' : 'Closed shift (Z report)'}>
        {report && <ShiftReportView s={report} currency={org.currency} />}
      </Dialog>
    </div>
  );
}
