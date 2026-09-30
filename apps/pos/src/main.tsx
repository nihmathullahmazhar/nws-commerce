import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@nws-commerce/ui';
import { App } from './App';
import { AuthProvider } from './lib/auth';
import './index.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 10_000, retry: 1 } } });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
