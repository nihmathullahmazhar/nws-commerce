import { describeDbError } from '@nws-commerce/db';

/** A sentence a shopper can act on, whatever went wrong. */
export function describeError(e: unknown): string {
  if (e && typeof e === 'object' && 'code' in e && 'message' in e) return describeDbError(e as Parameters<typeof describeDbError>[0]);
  if (e instanceof Error) {
    if (/network request failed|failed to fetch|load failed/i.test(e.message)) return 'Can\'t reach the shop. Check your connection and try again.';
    return e.message;
  }
  return 'Something went wrong. Please try again.';
}
