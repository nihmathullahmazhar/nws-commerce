import { useState, type ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router';
import clsx from 'clsx';
import {
  ArrowLeftRight, BadgePercent, BarChart3, Boxes, Gift, ChevronsUpDown, ClipboardList, LayoutDashboard, LogOut, Menu, Package, Receipt, Settings, ShieldCheck, Tags, Undo2, Users, X,
} from 'lucide-react';
import type { Enums } from '@nws-commerce/db';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useWorkspace } from '../lib/workspace';

interface NavItem { to: string; label: string; icon: ReactNode; permission: string; module?: Enums['module_key'] }

const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: <LayoutDashboard className="size-4" />, permission: 'reports.view' },
  { to: '/reports', label: 'Reports', icon: <BarChart3 className="size-4" />, permission: 'reports.view' },
  { to: '/orders', label: 'Orders', icon: <Receipt className="size-4" />, permission: 'orders.view' },
  { to: '/returns', label: 'Returns', icon: <Undo2 className="size-4" />, permission: 'orders.view', module: 'returns' },
  { to: '/warranty', label: 'Warranty', icon: <ShieldCheck className="size-4" />, permission: 'orders.view', module: 'warranty' },
  { to: '/products', label: 'Products', icon: <Package className="size-4" />, permission: 'catalog.view' },
  { to: '/catalogue', label: 'Categories & brands', icon: <Tags className="size-4" />, permission: 'catalog.manage' },
  { to: '/inventory', label: 'Inventory', icon: <Boxes className="size-4" />, permission: 'inventory.view' },
  { to: '/purchasing', label: 'Purchasing', icon: <ClipboardList className="size-4" />, permission: 'inventory.receive', module: 'purchasing' },
  { to: '/transfers', label: 'Transfers', icon: <ArrowLeftRight className="size-4" />, permission: 'inventory.view', module: 'transfers' },
  { to: '/promotions', label: 'Promotions', icon: <BadgePercent className="size-4" />, permission: 'catalog.view', module: 'promotions' },
  { to: '/gift-cards', label: 'Gift cards', icon: <Gift className="size-4" />, permission: 'orders.view', module: 'loyalty' },
  { to: '/customers', label: 'Customers', icon: <Users className="size-4" />, permission: 'customers.view' },
  { to: '/settings', label: 'Settings', icon: <Settings className="size-4" />, permission: 'settings.manage' },
];

export function visibleNav(can: (p: string) => boolean, has: (m: Enums['module_key']) => boolean = () => true) {
  return NAV.filter((n) => can(n.permission) && (!n.module || has(n.module)));
}

export function Shell() {
  const { session } = useAuth();
  const { workspaces, current, select, can, has } = useWorkspace();
  const [open, setOpen] = useState(false);

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="px-3 pt-4 pb-3">
        <label className="relative block">
          <span className="sr-only">Business</span>
          <select
            value={current?.id}
            onChange={(e) => select(e.target.value)}
            disabled={workspaces.length < 2}
            className="w-full appearance-none rounded-md border border-border bg-surface px-3 py-2 pr-8 text-left text-sm font-semibold text-text disabled:opacity-100"
          >
            {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          {workspaces.length > 1 && <ChevronsUpDown className="pointer-events-none absolute right-2.5 top-2.5 size-4 text-muted" />}
        </label>
        <div className="mt-1.5 px-1 text-xs capitalize text-muted">{current?.role.replace('_', ' ')}</div>
      </div>
      <nav className="flex-1 space-y-0.5 px-2">
        {visibleNav(can, has).map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            onClick={() => setOpen(false)}
            className={({ isActive }) => clsx(
              'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm',
              isActive ? 'bg-accent-soft font-medium text-accent' : 'text-muted hover:bg-surface-2 hover:text-text')}
          >
            {item.icon}{item.label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-border p-3">
        <div className="truncate px-1 text-xs text-muted" title={session?.user.email}>{session?.user.email}</div>
        <button
          onClick={() => supabase.auth.signOut()}
          className="mt-2 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-text"
        >
          <LogOut className="size-4" /> Sign out
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-full">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-r border-border bg-surface lg:block">{sidebar}</aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 border-r border-border bg-surface">
            <button className="absolute right-2 top-2 rounded p-1.5 text-muted" onClick={() => setOpen(false)} aria-label="Close menu">
              <X className="size-4" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="min-w-0 flex-1">
        <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-surface px-4 py-2.5 lg:hidden">
          <button onClick={() => setOpen(true)} className="rounded p-1.5 text-muted hover:bg-surface-2" aria-label="Open menu">
            <Menu className="size-5" />
          </button>
          <span className="truncate text-sm font-semibold">{current?.name}</span>
        </div>
        <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
