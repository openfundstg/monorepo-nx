import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpContext } from '@angular/common/http';
import { Observable } from 'rxjs';
import type {
  RedeemReferralCodeReq,
  ReferralBalancesRes,
  ReferralNameVisibilityReq,
  ReferralSummary,
  TransferReferralReq,
} from '@transacto/contracts';
import { environment } from '../../../environments/environment';
import { SKIP_LOADING } from '../../shared/constants/loading.const';

/** Transport only. */
@Injectable({ providedIn: 'root' })
export class ReferralApiService {
  private readonly http = inject(HttpClient);

  private readonly base = `${environment.apiUrl}/referral`;

  /** @param background `true` for a refetch triggered by a payout arriving. */
  getSummary(background = false): Observable<ReferralSummary> {
    return this.http.get<ReferralSummary>(this.base, {
      context: new HttpContext().set(SKIP_LOADING, background),
    });
  }

  redeem(code: string): Observable<ReferralSummary> {
    const body: RedeemReferralCodeReq = { code };

    return this.http.post<ReferralSummary>(`${this.base}/redeem`, body);
  }

  transfer(amount: number): Observable<ReferralBalancesRes> {
    const body: TransferReferralReq = { amount };

    return this.http.post<ReferralBalancesRes>(`${this.base}/transfer`, body);
  }

  setNameVisibility(showNameToReferrer: boolean): Observable<void> {
    const body: ReferralNameVisibilityReq = { showNameToReferrer };

    return this.http.patch<void>(`${this.base}/name-visibility`, body);
  }
}
