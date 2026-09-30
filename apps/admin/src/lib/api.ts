import { describeDbError, type DbErrorLike } from '@nws-commerce/db';

/** An error from the database, carrying both its code and a readable message. */
export class ApiError extends Error {
  code: string | undefined;
  constructor(error: DbErrorLike) {
    super(describeDbError(error));
    this.code = error.code;
  }
}

/**
 * Unwraps a supabase-js result, throwing an ApiError the UI can show as-is.
 * supabase-js types data as nullable even on success; once the error is ruled
 * out it is present for every read (writes without .select() return null, and
 * callers never read those).
 */
export function unwrap<T>(result: { data: T; error: DbErrorLike | null }): NonNullable<T> {
  if (result.error) throw new ApiError(result.error);
  return result.data as NonNullable<T>;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}
