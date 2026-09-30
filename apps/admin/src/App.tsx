import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { useAuth } from './lib/auth';
import { useWorkspace, WorkspaceProvider } from './lib/workspace';
import { Shell, visibleNav } from './components/Shell';
import { EmptyState, Spinner } from '@nws-commerce/ui';
import { Login } from './pages/Login';
import { supabase } from './lib/supabase';

// Each page is its own chunk; the shell and sign-in load first.
const Dashboard = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })));
const Products = lazy(() => import('./pages/Products').then((m) => ({ default: m.Products })));
const ProductEditor = lazy(() => import('./pages/ProductEditor').then((m) => ({ default: m.ProductEditor })));
const Catalogue = lazy(() => import('./pages/Catalogue').then((m) => ({ default: m.Catalogue })));
const Inventory = lazy(() => import('./pages/Inventory').then((m) => ({ default: m.Inventory })));
const ReceiveStock = lazy(() => import('./pages/ReceiveStock').then((m) => ({ default: m.ReceiveStock })));
const Orders = lazy(() => import('./pages/Orders').then((m) => ({ default: m.Orders })));
const OrderDetail = lazy(() => import('./pages/OrderDetail').then((m) => ({ default: m.OrderDetail })));
const Customers = lazy(() => import('./pages/Customers').then((m) => ({ default: m.Customers })));
const CustomerDetail = lazy(() => import('./pages/CustomerDetail').then((m) => ({ default: m.CustomerDetail })));
const Returns = lazy(() => import('./pages/Returns').then((m) => ({ default: m.Returns })));
const Warranty = lazy(() => import('./pages/Warranty').then((m) => ({ default: m.Warranty })));
const Purchasing = lazy(() => import('./pages/Purchasing').then((m) => ({ default: m.Purchasing })));
const Transfers = lazy(() => import('./pages/Transfers').then((m) => ({ default: m.Transfers })));
const Promotions = lazy(() => import('./pages/Promotions').then((m) => ({ default: m.Promotions })));
const GiftCards = lazy(() => import('./pages/GiftCards').then((m) => ({ default: m.GiftCards })));
const Reports = lazy(() => import('./pages/Reports').then((m) => ({ default: m.Reports })));
const SettingsPage = lazy(() => import('./pages/Settings').then((m) => ({ default: m.SettingsPage })));

export function App() {
  const { session, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!session) return <Login />;
  return (
    <WorkspaceProvider key={session.user.id}>
      <BrowserRouter>
        <Workspaced />
      </BrowserRouter>
    </WorkspaceProvider>
  );
}

function Workspaced() {
  const { current, loading, can, has } = useWorkspace();
  if (loading) return <Spinner label="Opening your business" />;
  if (!current) {
    return (
      <EmptyState title="You're not part of a business yet"
        action={<button className="text-sm text-accent underline" onClick={() => supabase.auth.signOut()}>Sign out</button>}>
        This account is signed in, but no business has added it as staff. Ask the owner to add your email under
        Settings → Staff, then sign in again.
      </EmptyState>
    );
  }
  const home = visibleNav(can, has)[0]?.to ?? '/orders';
  return (
    <Suspense fallback={<Spinner />}>
    <Routes>
      <Route element={<Shell />}>
        <Route index element={can('reports.view') ? <Dashboard /> : <Navigate to={home} replace />} />
        <Route path="orders" element={<Orders />} />
        <Route path="orders/:id" element={<OrderDetail />} />
        <Route path="products" element={<Products />} />
        <Route path="products/new" element={<ProductEditor />} />
        <Route path="products/:id" element={<ProductEditor />} />
        <Route path="catalogue" element={<Catalogue />} />
        <Route path="inventory" element={<Inventory />} />
        <Route path="inventory/receive" element={<ReceiveStock />} />
        <Route path="customers" element={<Customers />} />
        <Route path="customers/:id" element={<CustomerDetail />} />
        <Route path="returns" element={<Returns />} />
        <Route path="purchasing" element={<Purchasing />} />
        <Route path="transfers" element={<Transfers />} />
        <Route path="warranty" element={<Warranty />} />
        <Route path="reports" element={<Reports />} />
        <Route path="promotions" element={<Promotions />} />
        <Route path="gift-cards" element={<GiftCards />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
    </Suspense>
  );
}
