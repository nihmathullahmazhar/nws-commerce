/** Local numbers (077 123 4567) become +94771234567; returns null if it can't be a phone number. */
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
