import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import type {
  BankProvider,
  CancelSaleRes,
  CreateSaleResponse,
  ResolveDropLinkReq,
  ResolveDropLinkRes,
  SaleConfigResponse,
  SaleProgress,
  TmaSale,
  CreateSaleReq,
} from '@transacto/contracts';
import { environment } from '../../../environments/environment';

/** Payload for `POST /sales`, mirroring the backend DTO. */
export type { CreateSaleReq };

/** Transport only. */
@Injectable({ providedIn: 'root' })
export class SaleApiService {
  private readonly http = inject(HttpClient);

  private get base(): string {
    return `${environment.apiUrl}/sales`;
  }

  getConfig(): Observable<SaleConfigResponse> {
    return this.http.get<SaleConfigResponse>(`${this.base}/config`);
  }

  create(req: CreateSaleReq): Observable<CreateSaleResponse> {
    return this.http.post<CreateSaleResponse>(this.base, req);
  }

  /**
   * Turns a pasted link into the one the backend can scrape.
   *
   * Server-side because a cross-origin `Location` header is not readable from
   * the browser — PUMB's share link only reveals its `box_id` after a redirect.
   */
  resolveLink(req: ResolveDropLinkReq): Observable<ResolveDropLinkRes> {
    return this.http.post<ResolveDropLinkRes>(`${this.base}/resolve-link`, req);
  }

  /** Stops an order early; the backend decides whether that is allowed. */
  cancel(id: string): Observable<CancelSaleRes> {
    return this.http.post<CancelSaleRes>(`${this.base}/${id}/cancel`, {});
  }

  list(): Observable<{ orders: TmaSale[] }> {
    return this.http.get<{ orders: TmaSale[] }>(this.base);
  }

  getById(id: string): Observable<{ order: TmaSale }> {
    return this.http.get<{ order: TmaSale }>(`${this.base}/${id}`);
  }

  /** The live snapshot the status page renders — same shape as the WS push. */
  getProgress(id: string): Observable<SaleProgress> {
    return this.http.get<SaleProgress>(`${this.base}/${id}/progress`);
  }
}
