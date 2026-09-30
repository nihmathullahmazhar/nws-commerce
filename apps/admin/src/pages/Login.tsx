import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { Button, ErrorNote, Field, Input } from '@nws-commerce/ui';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setError(error.message === 'Invalid login credentials' ? 'That email and password do not match.' : error.message);
  }

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2.5">
          <div className="grid size-9 place-items-center rounded-lg bg-accent text-accent-fg">
            <svg viewBox="0 0 32 32" className="size-5" aria-hidden><path d="M9 22V10l14 12V10" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
          <div>
            <div className="text-sm font-semibold">NWS Commerce</div>
            <div className="text-xs text-muted">Store admin</div>
          </div>
        </div>
        <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-1 text-sm text-muted">Use the account your business owner added you with.</p>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <Field label="Email">
            <Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Password">
            <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <ErrorNote error={error} />
          <Button type="submit" variant="primary" busy={busy} className="w-full">Sign in</Button>
        </form>
      </div>
    </div>
  );
}
