import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import type {
  CreateDepositReq,
  CreateDepositResponse,
  DepositConfigResponse,
  DepositDetailResponse,
  DepositListResponse,
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
    const body: CreateDepositReq = { cryptoAmount };

    return this.http.post<CreateDepositResponse>(this.base, body);
  }

  verifyTx(depositId: string, txId: string): Observable<VerifyTxResponse> {
    return this.http.post<VerifyTxResponse>(`${this.base}/${depositId}/verify-tx`, { txId });
  }

  list(): Observable<DepositListResponse> {
    return this.http.get<DepositListResponse>(this.base);
  }

  getById(id: string): Observable<DepositDetailResponse> {
    return this.http.get<DepositDetailResponse>(`${this.base}/${id}`);
  }
}
