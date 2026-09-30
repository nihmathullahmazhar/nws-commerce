import type { Database, Enums } from '@nws-commerce/db';

export type WorkspaceRow = Database['public']['Functions']['my_workspaces']['Returns'][number];

export interface PosOrg {
  id: string;
  name: string;
  currency: string;
  role: Enums['staff_role'];
  permissions: string[];
  modules: Enums['module_key'][];
  settings: Record<string, unknown>;
}

export const toPosOrg = (w: WorkspaceRow): PosOrg => ({
  id: w.organization_id!, name: w.name!, currency: w.currency_code ?? 'LKR', role: w.role!,
  permissions: w.permissions ?? [], modules: w.modules ?? [], settings: (w.settings as Record<string, unknown>) ?? {},
});

export const can = (org: PosOrg, permission: string) => org.permissions.includes('*') || org.permissions.includes(permission);
