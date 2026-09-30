type Cell = string | number | boolean | null | undefined;

/** Saves rows as a CSV file Excel opens correctly (UTF-8 with BOM). */
export function downloadCsv(filename: string, header: string[], rows: Cell[][]) {
  const esc = (v: Cell) => {
    if (v === null || v === undefined) return '';
    let s = String(v);
    // A text cell starting with = + - @ would run as a formula in a spreadsheet.
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const text = [header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
