import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type {
  CreateDepositResponse,
  DepositConfigResponse,
  TmaDeposit,
  VerifyTxResponse,
} from '@transacto/contracts';
import { DepositApiService } from './deposit.api.service';

@Injectable({ providedIn: 'root' })
export class DepositService {
  private readonly api = inject(DepositApiService);

  getConfig(): Promise<DepositConfigResponse> {
    return firstValueFrom(this.api.getConfig());
  }

  create(cryptoAmount: number): Promise<CreateDepositResponse> {
    return firstValueFrom(this.api.create(cryptoAmount));
  }

  verifyTx(depositId: string, txId: string): Promise<VerifyTxResponse> {
    return firstValueFrom(this.api.verifyTx(depositId, txId));
  }

  async list(): Promise<TmaDeposit[]> {
    const { deposits } = await firstValueFrom(this.api.list());
    return deposits;
  }

  async getById(id: string): Promise<TmaDeposit> {
    const { deposit } = await firstValueFrom(this.api.getById(id));
    return deposit;
  }
}
