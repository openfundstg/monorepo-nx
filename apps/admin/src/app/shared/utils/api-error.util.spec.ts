import { HttpErrorResponse } from '@angular/common/http';
import { ERROR } from '@transacto/contracts';
import { describe, expect, it } from 'vitest';
import { isUnauthenticated, toApiError } from './api-error.util';

describe('toApiError', () => {
  it('unwraps the ERROR body the backend sends', () => {
    const error = new HttpErrorResponse({
      status: 401,
      error: ERROR.ADMIN.NO_SESSION,
    });

    expect(toApiError(error)).toEqual({
      code: ERROR.ADMIN.NO_SESSION.code,
      message: ERROR.ADMIN.NO_SESSION.message,
    });
  });

  it('falls back to the HTTP status when nothing reached a handler', () => {
    // A gateway error page, a dropped connection, a 404 on an unknown route —
    // none carry an ERROR body, and `undefined` in a template is worse than a
    // status code.
    const error = new HttpErrorResponse({ status: 502, error: '<html>bad gateway</html>' });

    expect(toApiError(error).code).toBe(502);
  });

  it('handles a thrown value that is not an HTTP response at all', () => {
    expect(toApiError(new Error('boom'))).toEqual({ code: 0, message: 'boom' });
  });
});

describe('isUnauthenticated', () => {
  it('recognises the session codes the interceptor acts on', () => {
    expect(isUnauthenticated(ERROR.ADMIN.NO_SESSION)).toBe(true);
    expect(isUnauthenticated(ERROR.ADMIN.INVALID_CREDENTIALS)).toBe(true);
  });

  it('leaves every other failure alone', () => {
    // A failed balance correction must not sign the operator out.
    expect(isUnauthenticated(ERROR.ADMIN.INSUFFICIENT_BALANCE)).toBe(false);
  });
});
