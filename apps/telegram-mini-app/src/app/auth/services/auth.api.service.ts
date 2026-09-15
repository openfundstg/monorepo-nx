import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import type { AuthResponse } from '@transacto/contracts';
import { environment } from '../../../environments/environment';

/** Transport only. */
@Injectable({ providedIn: 'root' })
export class AuthApiService {
  private readonly http = inject(HttpClient);

  /**
   * Exchanges the Telegram initData for a profile.
   *
   * The header is attached by `tmaAuthInterceptor`; the body is empty because
   * the credential *is* the header.
   */
  authenticate(): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${environment.apiUrl}/auth`, {});
  }
}
