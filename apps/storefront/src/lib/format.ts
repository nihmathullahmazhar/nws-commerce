const formatters = new Map<string, Intl.NumberFormat>();

export function money(value: number | string | null | undefined, currency = 'LKR'): string {
  if (value === null || value === undefined || value === '') return '';
  let f = formatters.get(currency);
  if (!f) {
    f = new Intl.NumberFormat('en-LK', { style: 'currency', currency, currencyDisplay: 'code', minimumFractionDigits: 2 });
    formatters.set(currency, f);
  }
  return f.format(Number(value)).replace(/ /g, ' ');
}

export function qty(value: number, unit?: string | null): string {
  const text = Number.isInteger(value) ? String(value) : value.toLocaleString('en-LK', { maximumFractionDigits: 3 });
  return unit && unit !== 'each' ? `${text} ${unit}` : text;
}

/** Product media lives in the Supabase Storage bucket "products". */
export function mediaUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/products/${path}`;
}

export const siteUrl = () => (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
