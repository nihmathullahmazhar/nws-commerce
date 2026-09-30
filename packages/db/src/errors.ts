// The database raises these SQLSTATEs (see docs/ARCHITECTURE.md). PostgREST
// passes them through as { code, message, details }.
export const ERROR_CODES = {
  NC001: 'OUT_OF_STOCK',
  NC002: 'MODULE_DISABLED',
  NC003: 'INVALID_INPUT',
  NC004: 'SERIAL_UNAVAILABLE',
  NC005: 'NOT_FOUND',
  NC006: 'INVALID_STATE',
  NC007: 'PAYMENT_INCOMPLETE',
  NC008: 'APPROVAL_REQUIRED',
  '42501': 'PERMISSION_DENIED',
  '23505': 'DUPLICATE',
} as const;

export interface DbErrorLike { code?: string; message?: string; details?: string | null; hint?: string | null }

function parseDetails(details: string | null | undefined): Record<string, unknown> | null {
  if (!details || !details.startsWith('{')) return null;
  try { return JSON.parse(details); } catch { return null; }
}

/** A sentence a shop worker can act on, from a database error. */
export function describeDbError(error: DbErrorLike | null | undefined): string {
  if (!error) return 'Something went wrong.';
  const details = error.details ?? '';
  const data = parseDetails(details);
  switch (error.code) {
    case 'NC001':
      return data ? `Not enough stock: ${data.available} available, ${data.requested} requested.` : 'Not enough stock.';
    case 'NC002':
      return `This needs the "${details.replace(/_/g, ' ')}" feature, which is not switched on for this business.`;
    case 'NC004':
      return 'That serial number is not in stock here. It may already be sold or held for another order.';
    case 'NC007':
      if (error.message === 'INSUFFICIENT_STORE_CREDIT' && data) return `Not enough store credit: balance ${data.balance}.`;
      return data ? `Payment is short: ${data.due} due, ${data.tendered} tendered.` : 'Payment is incomplete.';
    case 'NC008':
      return data ? `A ${data.discount_percent}% discount needs a manager's approval (your limit is ${data.your_limit}%).`
                  : "This needs a manager's approval.";
    case '42501':
      return details && !details.includes('.') ? `Not allowed: ${details}.` : "You don't have permission to do that.";
    case 'NC003': case 'NC005': case 'NC006':
      return details ? details.charAt(0).toUpperCase() + details.slice(1) + '.' : error.message ?? 'Invalid request.';
    case '23505':
      return 'That already exists.';
    default:
      return error.message || 'Something went wrong.';
  }
}
