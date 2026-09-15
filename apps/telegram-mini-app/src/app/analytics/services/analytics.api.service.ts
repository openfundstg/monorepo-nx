import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import type { IncomeAnalyticsResponse } from '@transacto/contracts';
import { environment } from '../../../environments/environment';

/** Transport only. */
@Injectable({ providedIn: 'root' })
export class AnalyticsApiService {
  private readonly http = inject(HttpClient);

  getIncome(): Observable<IncomeAnalyticsResponse> {
    return this.http.get<IncomeAnalyticsResponse>(`${environment.apiUrl}/analytics/income`);
  }
}
