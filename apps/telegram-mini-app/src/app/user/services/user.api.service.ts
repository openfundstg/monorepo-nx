import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpContext } from '@angular/common/http';
import { Observable } from 'rxjs';
import type { BalanceHistoryResponse, UserProfileResponse } from '@transacto/contracts';
import { environment } from '../../../environments/environment';
import { SKIP_LOADING } from '../../shared/constants/loading.const';

/** Transport only. */
@Injectable({ providedIn: 'root' })
export class UserApiService {
  private readonly http = inject(HttpClient);

  /**
   * @param background `true` for a refetch the user did not ask for — a socket
   * push, say — so it does not raise the loading overlay over whatever they are
   * currently reading.
   */
  getProfile(background = false): Observable<UserProfileResponse> {
    return this.http.get<UserProfileResponse>(`${environment.apiUrl}/user/profile`, {
      context: new HttpContext().set(SKIP_LOADING, background),
    });
  }

  getBalanceHistory(): Observable<BalanceHistoryResponse> {
    return this.http.get<BalanceHistoryResponse>(
      `${environment.apiUrl}/user/balance-history`,
    );
  }
}
