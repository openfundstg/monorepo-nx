import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import type {
  CreateDepositResponse,
  DepositConfigResponse,
  TmaDeposit,
  VerifyTxResponse,
} from '@transacto/contracts';
import { environment } from '../../../environments/environment';

/** Transport only. */
@Injectable({ providedIn: 'root' })
export class DepositApiService {
  private readonly http = inject(HttpClient);

  private get base(): string {
    return `${environment.apiUrl}/deposits`;
  }

  getConfig(): Observable<DepositConfigResponse> {
    return this.http.get<DepositConfigResponse>(`${this.base}/config`);
  }

  create(cryptoAmount: number): Observable<CreateDepositResponse> {
    return this.http.post<CreateDepositResponse>(this.base, { cryptoAmount });
  }

  verifyTx(depositId: string, txId: string): Observable<VerifyTxResponse> {
    return this.http.post<VerifyTxResponse>(`${this.base}/${depositId}/verify-tx`, { txId });
  }

  list(): Observable<{ deposits: TmaDeposit[] }> {
    return this.http.get<{ deposits: TmaDeposit[] }>(this.base);
  }

  getById(id: string): Observable<{ deposit: TmaDeposit }> {
    return this.http.get<{ deposit: TmaDeposit }>(`${this.base}/${id}`);
  }
}
