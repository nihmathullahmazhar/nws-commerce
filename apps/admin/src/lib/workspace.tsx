import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Database, Enums, Tables } from '@nws-commerce/db';
import { supabase } from './supabase';
import { unwrap } from './api';

export type WorkspaceRow = Database['public']['Functions']['my_workspaces']['Returns'][number];

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  currency: string;
  /** IANA zone; reports count days in it. */
  timezone: string;
  pricesIncludeTax: boolean;
  settings: Record<string, unknown>;
  role: Enums['staff_role'];
  permissions: string[];
  locationIds: string[] | null;
  modules: Enums['module_key'][];
}

interface WorkspaceState {
  workspaces: Workspace[];
  current: Workspace | null;
  locations: Tables<'locations'>[];
  loading: boolean;
  select: (id: string) => void;
  /** Mirrors role_permissions() in the database; the database still decides. */
  can: (permission: string) => boolean;
  has: (module: Enums['module_key']) => boolean;
}

const WorkspaceContext = createContext<WorkspaceState | null>(null);
const STORAGE_KEY = 'nwsc-admin-workspace';

function toWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.organization_id ?? '',
    name: row.name ?? '',
    slug: row.slug ?? '',
    currency: row.currency_code ?? 'LKR',
    timezone: row.timezone ?? 'Asia/Colombo',
    pricesIncludeTax: row.prices_include_tax ?? true,
    settings: (row.settings as Record<string, unknown>) ?? {},
    role: row.role ?? 'viewer',
    permissions: row.permissions ?? [],
    locationIds: row.location_ids ?? null,
    modules: row.modules ?? [],
  };
}

function readStored(): string | null {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<string | null>(readStored);

  const workspacesQuery = useQuery({
    queryKey: ['workspaces'],
    queryFn: async () => unwrap(await supabase.rpc('my_workspaces')).map(toWorkspace),
  });
  const workspaces = useMemo(() => workspacesQuery.data ?? [], [workspacesQuery.data]);
  const current = workspaces.find((w) => w.id === selected) ?? workspaces[0] ?? null;

  const locationsQuery = useQuery({
    queryKey: ['locations', current?.id],
    enabled: !!current,
    queryFn: async () =>
      unwrap(await supabase.from('locations').select('*').eq('organization_id', current!.id)
        .order('fulfilment_priority').order('name')),
  });

  useEffect(() => {
    if (current) try { localStorage.setItem(STORAGE_KEY, current.id); } catch { /* private mode */ }
  }, [current]);

  const value = useMemo<WorkspaceState>(() => ({
    workspaces,
    current,
    locations: locationsQuery.data ?? [],
    loading: workspacesQuery.isLoading || (!!current && locationsQuery.isLoading),
    select: setSelected,
    can: (permission) => !!current && (current.permissions.includes('*') || current.permissions.includes(permission)),
    has: (module) => !!current && current.modules.includes(module),
  }), [workspaces, current, locationsQuery.data, locationsQuery.isLoading, workspacesQuery.isLoading]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace outside WorkspaceProvider');
  return ctx;
}

/** The current workspace, for pages that only render once one is loaded. */
export function useOrg(): Workspace & { locations: Tables<'locations'>[]; can: WorkspaceState['can']; has: WorkspaceState['has'] } {
  const { current, locations, can, has } = useWorkspace();
  if (!current) throw new Error('no workspace');
  return { ...current, locations, can, has };
}
