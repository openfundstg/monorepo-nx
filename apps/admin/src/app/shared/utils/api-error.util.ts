import { HttpErrorResponse } from '@angular/common/http';
import { ERROR, type ApiError } from '@transacto/contracts';

/**
 * Whatever the HTTP layer threw, as an `ApiError`.
 *
 * The backend answers every failure with `{ code, message }` from the shared
 * `ERROR` constant, so the happy path here is just unwrapping the body. The
 * rest exists for the failures that never reached a handler — a dropped
 * connection, a proxy's own error page — which have no code at all and would
 * otherwise surface as `undefined` in a template.
 *
 * **`message` is developer-facing English and is never shown to an operator.**
 * The panel switches on `code` and renders its own copy, exactly as the other
 * two frontends do. The message goes to the console.
 */
export const toApiError = (error: unknown): ApiError => {
  if (error instanceof HttpErrorResponse) {
    const body = error.error as Partial<ApiError> | null;

    if (body && typeof body.code === 'number' && typeof body.message === 'string')
      return { code: body.code, message: body.message };

    // A response with no `ERROR` body did not come from a handler — it is a
    // network failure, a gateway page, or a 404 on a route that does not exist.
    return { code: error.status, message: error.message };
  }

  return { code: 0, message: error instanceof Error ? error.message : String(error) };
};

/** The one code the whole app treats specially: the session is gone. */
export const isUnauthenticated = (error: ApiError): boolean =>
  error.code === ERROR.ADMIN.NO_SESSION.code || error.code === ERROR.ADMIN.INVALID_CREDENTIALS.code;
