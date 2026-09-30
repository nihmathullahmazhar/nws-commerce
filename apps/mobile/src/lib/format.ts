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

export function qty(value: number, unit?: string | null): string {
  const text = Number.isInteger(value) ? String(value) : value.toLocaleString('en-LK', { maximumFractionDigits: 3 });
  return unit && unit !== 'each' ? `${text} ${unit}` : text;
}

export function dateTime(value: string): string {
  return new Date(value).toLocaleString('en-LK', { dateStyle: 'medium', timeStyle: 'short' });
}

export function shortDate(value: string): string {
  return new Date(value).toLocaleDateString('en-LK', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Local numbers (077 123 4567) become +94771234567; null if it can't be a phone number. */
export function normalisePhone(input: string, countryCode = '94'): string | null {
  const digits = input.trim().replace(/[^\d+]/g, '');
  if (!digits) return null;
  let e164: string;
  if (digits.startsWith('+')) e164 = '+' + digits.slice(1).replace(/\D/g, '');
  else if (digits.startsWith('00')) e164 = '+' + digits.slice(2);
  else if (digits.startsWith('0')) e164 = `+${countryCode}${digits.slice(1)}`;
  else e164 = `+${countryCode}${digits}`;
  return /^\+[1-9]\d{6,14}$/.test(e164) ? e164 : null;
}

export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('');
