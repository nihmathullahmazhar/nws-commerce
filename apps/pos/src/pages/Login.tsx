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
    <div className="flex h-full items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto grid size-12 place-items-center rounded-xl bg-accent text-accent-fg text-lg font-bold">N</div>
          <h1 className="mt-4 text-xl font-semibold">Till sign-in</h1>
          <p className="mt-1 text-sm text-muted">Each cashier signs in with their own account.</p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Email"><Input className="h-11" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Password"><Input className="h-11" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          <ErrorNote error={error} />
          <Button type="submit" variant="primary" busy={busy} className="h-11 w-full">Sign in</Button>
        </form>
      </div>
    </div>
  );
}
