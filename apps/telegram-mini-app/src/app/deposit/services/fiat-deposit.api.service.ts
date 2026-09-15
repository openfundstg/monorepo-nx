import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import type {
  FiatDepositOptionsResponse,
  FiatDepositWatch,
  SaveFiatDepositWatchReq,
  TmaFiatDeposit,
} from '@transacto/contracts';
import { environment } from '../../../environments/environment';

/** Transport only. */
@Injectable({ providedIn: 'root' })
export class FiatDepositApiService {
  private readonly http = inject(HttpClient);

  private get base(): string {
    return `${environment.apiUrl}/fiat-deposits`;
  }

  getOptions(): Observable<FiatDepositOptionsResponse> {
    return this.http.get<FiatDepositOptionsResponse>(`${this.base}/options`);
  }

  getWatch(): Observable<FiatDepositWatch | null> {
    return this.http.get<FiatDepositWatch | null>(`${this.base}/watch`);
  }

  /** `PUT`, because there is one per user — asking twice must not make two. */
  saveWatch(body: SaveFiatDepositWatchReq): Observable<FiatDepositWatch> {
    return this.http.put<FiatDepositWatch>(`${this.base}/watch`, body);
  }

  removeWatch(): Observable<void> {
    return this.http.delete<void>(`${this.base}/watch`);
  }

  getActive(): Observable<TmaFiatDeposit | null> {
    return this.http.get<TmaFiatDeposit | null>(`${this.base}/active`);
  }

  getById(id: string): Observable<TmaFiatDeposit> {
    return this.http.get<TmaFiatDeposit>(`${this.base}/${id}`);
  }

  reserve(amountUah: number): Observable<TmaFiatDeposit> {
    return this.http.post<TmaFiatDeposit>(this.base, { amountUah });
  }

  /**
   * The receipt goes up as multipart, with no `Content-Type` set by hand — the
   * browser has to add the boundary, and setting the header would strip it.
   */
  uploadReceipt(id: string, file: File): Observable<TmaFiatDeposit> {
    const form = new FormData();
    form.append('file', file);

    return this.http.post<TmaFiatDeposit>(`${this.base}/${id}/receipts`, form);
  }

  appeal(id: string): Observable<TmaFiatDeposit> {
    return this.http.post<TmaFiatDeposit>(`${this.base}/${id}/appeal`, {});
  }

  cancel(id: string): Observable<TmaFiatDeposit> {
    return this.http.post<TmaFiatDeposit>(`${this.base}/${id}/cancel`, {});
  }
}
