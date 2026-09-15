import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import type { TrustLevelLadderResponse } from '@transacto/contracts';
import { environment } from '../../../environments/environment';

/** Transport only. */
@Injectable({ providedIn: 'root' })
export class TrustLevelApiService {
  private readonly http = inject(HttpClient);

  getLadder(): Observable<TrustLevelLadderResponse> {
    return this.http.get<TrustLevelLadderResponse>(`${environment.apiUrl}/trust-levels`);
  }
}
