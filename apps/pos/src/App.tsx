import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LogOut, MonitorSmartphone } from 'lucide-react';
import type { PosContext, ShiftSummary } from '@nws-commerce/db';
import { Button, Card, Dialog, EmptyState, ErrorNote, Field, Input, Spinner } from '@nws-commerce/ui';
import { useAuth } from './lib/auth';
import { supabase } from './lib/supabase';
import { unwrap } from './lib/api';
import { money } from './lib/format';
import { can, toPosOrg, type PosOrg } from './lib/org';
import { Login } from './pages/Login';
import { Register } from './pages/Register';

export function App() {
  const { session, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!session) return <Login />;
  return <OrgGate key={session.user.id} />;
}

function OrgGate() {
  const [chosen, setChosen] = useState<string | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ['pos-workspaces'],
    queryFn: async () => unwrap(await supabase.rpc('my_workspaces')).map(toPosOrg)
      .filter((o) => o.modules.includes('pos') && can(o, 'pos.sell')),
  });
  if (isLoading) return <Spinner label="Opening the till" />;
  if (error) return <div className="p-6"><ErrorNote error={error} /></div>;
  const orgs = data ?? [];
  const org = orgs.length === 1 ? orgs[0] : orgs.find((o) => o.id === chosen);
  if (orgs.length === 0) {
    return (
      <EmptyState icon={<MonitorSmartphone className="size-5" />} title="No till access"
        action={<Button onClick={() => supabase.auth.signOut()} icon={<LogOut className="size-4" />}>Sign out</Button>}>
        This account can't sell at a till. Ask a manager to give you the cashier role in a business that has point of sale switched on.
      </EmptyState>
    );
  }
  if (!org) {
    return (
      <div className="mx-auto max-w-md space-y-2 p-6 pt-20">
        <h1 className="mb-4 text-lg font-semibold">Which business?</h1>
        {orgs.map((o) => <Button key={o.id} className="h-12 w-full justify-start" onClick={() => setChosen(o.id)}>{o.name}</Button>)}
      </div>
    );
  }
  return <TillGate org={org} />;
}

function TillGate({ org }: { org: PosOrg }) {
  const qc = useQueryClient();
  const [opening, setOpening] = useState<PosContext['terminals'][number] | null>(null);
  const [float, setFloat] = useState('');
  const [openError, setOpenError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['pos-context', org.id],
    queryFn: async () => unwrap(await supabase.rpc('pos_context', { p_organization_id: org.id })) as unknown as PosContext,
  });

  if (isLoading) return <Spinner label="Finding your till" />;
  if (error || !data) return <div className="p-6"><ErrorNote error={error} /></div>;
  if (data.my_open_shift) {
    return <Register org={org} shift={data.my_open_shift} onShiftClosed={() => { qc.invalidateQueries({ queryKey: ['pos-context'] }); void refetch(); }} />;
  }

  async function open() {
    setBusy(true);
    setOpenError(null);
    try {
      const summary = unwrap(await supabase.rpc('pos_open_shift', { p_terminal_id: opening!.id, p_opening_float: Number(float || 0) })) as unknown as ShiftSummary;
      setOpening(null);
      qc.setQueryData(['pos-context', org.id], { ...data!, my_open_shift: summary });
    } catch (e) { setOpenError(e); } finally { setBusy(false); }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl p-6 pt-12">
        <div className="mb-6 flex items-center justify-between">
          <div><h1 className="text-xl font-semibold">{org.name}</h1><p className="text-sm text-muted">Choose the till you are working on.</p></div>
          <Button variant="ghost" icon={<LogOut className="size-4" />} onClick={() => supabase.auth.signOut()}>Sign out</Button>
        </div>
        {data.terminals.length === 0 ? (
          <Card><p className="text-sm text-muted">No tills are set up here yet. A manager adds them in the admin under Settings → Tills.</p></Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {data.terminals.map((t) => (
              <button key={t.id} disabled={!!t.open_shift}
                onClick={() => { setOpening(t); setFloat(''); }}
                className="rounded-xl border border-border bg-surface p-5 text-left enabled:hover:border-accent disabled:opacity-60">
                <div className="text-base font-semibold">{t.name}</div>
                <div className="text-sm text-muted">{t.location} · {t.code}</div>
                <div className="mt-3 text-sm">{t.open_shift ? <span className="text-warn">In use by {t.open_shift.cashier}</span> : <span className="text-ok">Free - tap to open a shift</span>}</div>
              </button>
            ))}
          </div>
        )}
      </div>
      <Dialog open={!!opening} onClose={() => setOpening(null)} title={`Open ${opening?.name ?? ''}`}
        description="Count the cash in the drawer before you start. Every sale on this shift is recorded against you."
        footer={<><Button onClick={() => setOpening(null)}>Cancel</Button><Button variant="primary" busy={busy} onClick={open}>Open shift</Button></>}>
        <ErrorNote error={openError} />
        <Field label={`Opening float (${org.currency})`} hint={float ? money(Number(float), org.currency) : 'Enter 0 if the drawer is empty.'}>
          <Input autoFocus className="h-12 text-lg" type="number" min="0" step="0.01" value={float} onChange={(e) => setFloat(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void open(); }} />
        </Field>
      </Dialog>
    </div>
  );
}
