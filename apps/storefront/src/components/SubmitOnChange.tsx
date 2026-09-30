'use client';

import type { SelectHTMLAttributes } from 'react';

/** A select that submits its form when changed (the form still has a button for no-JS). */
export function SubmitOnChangeSelect(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} onChange={(e) => e.currentTarget.form?.requestSubmit()} />;
}
