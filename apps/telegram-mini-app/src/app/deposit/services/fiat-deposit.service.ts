import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type {
  FiatDepositOptionsResponse,
  FiatDepositWatch,
  SaveFiatDepositWatchReq,
  TmaFiatDeposit,
} from '@transacto/contracts';
import { FiatDepositApiService } from './fiat-deposit.api.service';

@Injectable({ providedIn: 'root' })
export class FiatDepositService {
  private readonly api = inject(FiatDepositApiService);

  getOptions(): Promise<FiatDepositOptionsResponse> {
    return firstValueFrom(this.api.getOptions());
  }

  /**
   * This user's standing request for an amount.
   *
   * For screens that do not poll the offer. The amounts list gets the same
   * value on its own response, so a request made there is echoed by the next
   * refresh rather than flickering back to "not subscribed".
   */
  getWatch(): Promise<FiatDepositWatch | null> {
    return firstValueFrom(this.api.getWatch());
  }

  saveWatch(body: SaveFiatDepositWatchReq): Promise<FiatDepositWatch> {
    return firstValueFrom(this.api.saveWatch(body));
  }

  removeWatch(): Promise<void> {
    return firstValueFrom(this.api.removeWatch());
  }

  getActive(): Promise<TmaFiatDeposit | null> {
    return firstValueFrom(this.api.getActive());
  }

  getById(id: string): Promise<TmaFiatDeposit> {
    return firstValueFrom(this.api.getById(id));
  }

  reserve(amountUah: number): Promise<TmaFiatDeposit> {
    return firstValueFrom(this.api.reserve(amountUah));
  }

  uploadReceipt(id: string, file: File): Promise<TmaFiatDeposit> {
    return firstValueFrom(this.api.uploadReceipt(id, file));
  }

  /**
   * Asks an operator to look at a top-up whose pay window ran out.
   *
   * Sent before the support bot is opened, not instead of it: the write is what
   * stops the payout being handed back automatically, and the chat is where the
   * user proves the transfer.
   */
  appeal(id: string): Promise<TmaFiatDeposit> {
    return firstValueFrom(this.api.appeal(id));
  }

  cancel(id: string): Promise<TmaFiatDeposit> {
    return firstValueFrom(this.api.cancel(id));
  }
}
