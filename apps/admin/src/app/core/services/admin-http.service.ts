import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { AdminPageReq, AdminPaginatedRes } from '@transacto/contracts';
import type { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

/**
 * The two request shapes the admin API has, and nothing else.
 *
 * Every screen either reads a page of rows or sends a command about one row, so
 * the per-feature `*.api.service.ts` files reduce to a path and a type
 * parameter. Eleven hand-written services would each rebuild the same
 * `HttpParams`, and the one that forgot to drop an empty `search` would send
 * `?search=` and match nothing.
 *
 * Cookies ride along because every call is same-origin — see the note in
 * `environment.ts`. `withCredentials` is deliberately absent: it would be
 * meaningless here, and setting it invites the assumption that a cross-origin
 * deployment would work, which the backend's CORS configuration refuses.
 */
@Injectable({ providedIn: 'root' })
export class AdminHttpService {
  private readonly http = inject(HttpClient);

  /** One page of a collection. */
  list<T>(path: string, query: AdminPageReq): Observable<AdminPaginatedRes<T>> {
    return this.http.get<AdminPaginatedRes<T>>(`${environment.apiUrl}/${path}`, {
      params: this.toParams(query),
    });
  }

  get<T>(path: string): Observable<T> {
    return this.http.get<T>(`${environment.apiUrl}/${path}`);
  }

  /** A state-changing call. The CSRF header is added by the interceptor. */
  command<TBody, TRes>(path: string, body: TBody): Observable<TRes> {
    return this.http.post<TRes>(`${environment.apiUrl}/${path}`, body);
  }

  /**
   * A delete that carries a body.
   *
   * Angular's `HttpClient.delete` takes one, and the admin API needs it: the
   * reason for removing an alert is the only thing that outlives the row, so it
   * cannot go in the query string where every access log would keep a copy.
   */
  remove<TBody>(path: string, body: TBody): Observable<void> {
    return this.http.delete<void>(`${environment.apiUrl}/${path}`, { body });
  }

  /**
   * Only the parameters that carry a value.
   *
   * An empty `search` must not be sent at all: the backend's `ValidationPipe`
   * runs with `forbidNonWhitelisted`, and more to the point an empty string is
   * a filter that matches nothing rather than a filter that is off.
   */
  private toParams(query: AdminPageReq): HttpParams {
    return Object.entries(query).reduce(
      (params, [key, value]) =>
        value === undefined || value === null || value === ''
          ? params
          : params.set(key, String(value)),
      new HttpParams(),
    );
  }
}
