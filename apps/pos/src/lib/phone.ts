/**
 * Normalises a phone number to E.164, which is how the database stores it.
 * Local Sri Lankan numbers (077 123 4567) become +94771234567; numbers already
 * starting with + are kept. Returns null when it cannot be a phone number.
 */
export function normalisePhone(input: string, defaultCountryCode = '94'): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/[^\d+]/g, '');
  let e164: string;
  if (digits.startsWith('+')) e164 = '+' + digits.slice(1).replace(/\D/g, '');
  else if (digits.startsWith('00')) e164 = '+' + digits.slice(2);
  else if (digits.startsWith('0')) e164 = `+${defaultCountryCode}${digits.slice(1)}`;
  else e164 = `+${defaultCountryCode}${digits}`;
  return /^\+[1-9]\d{6,14}$/.test(e164) ? e164 : null;
}
