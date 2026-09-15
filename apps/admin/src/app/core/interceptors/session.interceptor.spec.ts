import { HttpErrorResponse, HttpRequest, type HttpEvent } from '@angular/common/http';
import { runInInjectionContext, Injector } from '@angular/core';
import { ERROR } from '@transacto/contracts';
import { Store } from '@ngrx/store';
import { throwError, of, type Observable } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { authActions } from '../../auth/store/auth.actions';
import { sessionInterceptor } from './session.interceptor';

const unauthorised = () => new HttpErrorResponse({ status: 401, error: ERROR.ADMIN.NO_SESSION });

const run = (url: string, response: Observable<HttpEvent<unknown>>) => {
  const dispatch = vi.fn();
  const injector = Injector.create({
    providers: [{ provide: Store, useValue: { dispatch } }],
  });

  const result = runInInjectionContext(injector, () =>
    sessionInterceptor(new HttpRequest('GET', url), () => response),
  );

  return { dispatch, result };
};

describe('sessionInterceptor', () => {
  it('signs the operator out when any screen hits an expired session', async () => {
    const { dispatch, result } = run(
      '/api/admin/users',
      throwError(() => unauthorised()),
    );

    await expect(
      new Promise((_, reject) => result.subscribe({ error: reject })),
    ).rejects.toBeDefined();
    expect(dispatch).toHaveBeenCalledWith(authActions.sessionExpired());
  });

  /**
   * The probe is how the app asks whether there is a session at all, so a 401
   * is its answer. Treating it as an expiry put "your session has ended" in
   * front of every first-time visitor — which is exactly what it did until a
   * browser was pointed at the login page.
   */
  it('does not report an expiry for the session probe itself', async () => {
    const { dispatch, result } = run(
      '/api/admin/auth/me',
      throwError(() => unauthorised()),
    );

    await expect(
      new Promise((_, reject) => result.subscribe({ error: reject })),
    ).rejects.toBeDefined();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('leaves a successful response alone', async () => {
    const { dispatch, result } = run('/api/admin/users', of({} as HttpEvent<unknown>));

    await new Promise<void>((resolve) => result.subscribe({ complete: resolve }));
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('does not sign the operator out for an ordinary failure', async () => {
    const failed = new HttpErrorResponse({ status: 409, error: ERROR.ADMIN.INSUFFICIENT_BALANCE });
    const { dispatch, result } = run(
      '/api/admin/users/1/balance',
      throwError(() => failed),
    );

    await expect(
      new Promise((_, reject) => result.subscribe({ error: reject })),
    ).rejects.toBeDefined();
    expect(dispatch).not.toHaveBeenCalled();
  });
});
