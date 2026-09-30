const moneyFormatters = new Map<string, Intl.NumberFormat>();

export function money(value: number | string | null | undefined, currency = 'LKR'): string {
  if (value === null || value === undefined || value === '') return '-';
  let f = moneyFormatters.get(currency);
  if (!f) {
    f = new Intl.NumberFormat('en-LK', { style: 'currency', currency, currencyDisplay: 'code', minimumFractionDigits: 2 });
    moneyFormatters.set(currency, f);
  }
  return f.format(Number(value)).replace(/ /g, ' ');
}

export function qty(value: number | string | null | undefined, unit?: string | null): string {
  if (value === null || value === undefined) return '-';
  const n = Number(value);
  const text = Number.isInteger(n) ? n.toLocaleString('en-LK') : n.toLocaleString('en-LK', { maximumFractionDigits: 3 });
  return unit && unit !== 'each' ? `${text} ${unit}` : text;
}

export function dateTime(value: string | null | undefined): string {
  if (!value) return '-';
  return new Date(value).toLocaleString('en-LK', { dateStyle: 'medium', timeStyle: 'short' });
}

export function date(value: string | null | undefined): string {
  if (!value) return '-';
  return new Date(value).toLocaleDateString('en-LK', { dateStyle: 'medium' });
}

export function titleCase(value: string | null | undefined): string {
  if (!value) return '';
  return value.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

export function newIdempotencyKey(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}
