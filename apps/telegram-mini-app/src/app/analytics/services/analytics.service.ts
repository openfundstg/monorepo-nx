import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { IncomeAnalyticsResponse } from '@transacto/contracts';
import { AnalyticsApiService } from './analytics.api.service';

/**
 * The income page's one read.
 *
 * Thin on purpose, and it stays thin: the figures are computed on the server
 * and arrive finished. A client that derived any of them — a profit from two
 * totals, an average from a sum and a count — would be a second implementation
 * of arithmetic about somebody's money, and the two would disagree the first
 * time either rounded.
 */
@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  private readonly api = inject(AnalyticsApiService);

  async getIncome(): Promise<IncomeAnalyticsResponse> {
    return firstValueFrom(this.api.getIncome());
  }
}
