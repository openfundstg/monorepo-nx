import { inject } from '@angular/core';
import { HttpInterceptorFn } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { SessionService } from '../services/session.service';

export const API_TOKEN_HEADER = 'X-API-TOKEN';

/**
 * Attaches the trader's API token to every call to our own backend.
 *
 * Replaces the `headers: { 'X-API-TOKEN': token }` that every service method
 * used to repeat, along with the `if (!token) return` that guarded each one.
 *
 * Two deliberate pass-throughs:
 * - requests to any other host are left alone;
 * - a request that already carries the header keeps it, which is how login
 *   submits a token that is not the stored one.
 */
export const apiTokenInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(environment.apiUrl) || req.headers.has(API_TOKEN_HEADER)) {
    return next(req);
  }

  const token = inject(SessionService).token();
  if (!token) return next(req);

  return next(req.clone({ setHeaders: { [API_TOKEN_HEADER]: token } }));
};
