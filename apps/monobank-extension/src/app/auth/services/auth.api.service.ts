import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { API_TOKEN_HEADER } from '../../core/interceptors/api-token.interceptor';
import type { LoginRes } from '../api/login.res';

/** Transport only — every decision lives in `AuthService`. */
@Injectable({ providedIn: 'root' })
export class AuthApiService {
  private readonly http = inject(HttpClient);

  /**
   * Exchanges an API token for a trader id.
   *
   * The header is set explicitly because this is the one call that must use the
   * token being *tested* rather than the stored one — see `apiTokenInterceptor`.
   */
  login(apiToken: string): Observable<LoginRes> {
    return this.http.post<LoginRes>(
      `${environment.apiUrl}/extension/auth`,
      {},
      { headers: { [API_TOKEN_HEADER]: apiToken } },
    );
  }

  deactivate(traderId: string): Observable<void> {
    return this.http.post<void>(`${environment.apiUrl}/extension/trader/${traderId}/deactivate`, {});
  }
}
