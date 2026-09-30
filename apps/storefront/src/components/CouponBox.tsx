'use client';

import { useState } from 'react';

/** Apply or remove a coupon code. The quote decides whether it applies. */
export function CouponBox({ coupon, applied, error, onChange }: {
  coupon: string | null; applied: boolean; error: string | null; onChange: (code: string | null) => void;
}) {
  const [value, setValue] = useState('');
  // Not a <form>: the box sits inside the checkout form.
  function submit() {
    const code = value.trim().toUpperCase();
    if (code) { onChange(code); setValue(''); }
  }
  if (coupon && !error) {
    return (
      <div className="flex items-center justify-between rounded-md border border-line px-3 py-2 text-sm">
        <span>Code <span className="font-mono font-medium">{coupon}</span>{applied ? '' : ' (checking...)'}</span>
        <button type="button" onClick={() => onChange(null)} className="text-xs text-ink-2 underline">Remove</button>
      </div>
    );
  }
  return (
    <div>
      <div className="flex gap-2">
        <label htmlFor="coupon" className="sr-only">Coupon code</label>
        <input id="coupon" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Coupon code"
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }} autoComplete="off"
          className="h-10 min-w-0 flex-1 rounded-md border border-line bg-surface px-3 font-mono text-sm uppercase text-ink placeholder:font-sans placeholder:normal-case focus:border-ink focus:outline-none" />
        <button type="button" onClick={submit} disabled={!value.trim()} className="h-10 rounded-md border border-ink px-4 text-sm font-medium disabled:opacity-40">Apply</button>
      </div>
      {error && coupon && (
        <p role="alert" className="mt-1.5 text-xs text-danger">
          {coupon}: {error}{' '}
          <button type="button" onClick={() => onChange(null)} className="underline">Clear</button>
        </p>
      )}
    </div>
  );
}
