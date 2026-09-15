import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { ReferralBalancesRes, ReferralSummary } from '@transacto/contracts';
import { ReferralApiService } from './referral.api.service';

@Injectable({ providedIn: 'root' })
export class ReferralService {
  private readonly api = inject(ReferralApiService);

  /** See {@link ReferralApiService.getSummary} for `background`. */
  getSummary(background = false): Promise<ReferralSummary> {
    return firstValueFrom(this.api.getSummary(background));
  }

  /** Returns the refreshed summary, so the page repaints from one response. */
  redeem(code: string): Promise<ReferralSummary> {
    return firstValueFrom(this.api.redeem(code));
  }

  /** `amount` is USDT cents. */
  transfer(amount: number): Promise<ReferralBalancesRes> {
    return firstValueFrom(this.api.transfer(amount));
  }

  setNameVisibility(showNameToReferrer: boolean): Promise<void> {
    return firstValueFrom(this.api.setNameVisibility(showNameToReferrer));
  }
}
