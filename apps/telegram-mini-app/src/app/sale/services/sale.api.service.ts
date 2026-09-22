import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import type {
  ConfirmCardOrderReq,
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

  /**
   * The seller says one card order's money reached their card.
   *
   * Answers with the same `SaleProgress` the socket pushes, so the screen the
   * button was pressed on updates from the response rather than waiting for a
   * round trip through the gateway.
   */
  confirmOrder(
    id: string,
    orderId: number,
    receivedAmount?: number,
  ): Observable<SaleProgress> {
    // An empty body is the ordinary answer and means the whole order arrived —
    // the same thing the bot's inline key says, which cannot carry a number.
    const body: ConfirmCardOrderReq = receivedAmount === undefined ? {} : { receivedAmount };

    return this.http.post<SaleProgress>(`${this.base}/${id}/orders/${orderId}/confirm`, body);
  }

  /**
   * The seller says the hand-made transfer that closes their sale arrived.
   *
   * **No body, and there is nothing to put in one.** A tail has no order behind
   * it and therefore no order id, and the amount is the gap the server re-reads
   * — a figure named here would be a figure this screen had let go stale.
   */
  confirmTail(id: string): Observable<SaleProgress> {
    return this.http.post<SaleProgress>(`${this.base}/${id}/tail/confirm`, {});
  }

  /** …and stops waiting for it, taking the gap back as USDT instead. */
  releaseTail(id: string): Observable<SaleProgress> {
    return this.http.post<SaleProgress>(`${this.base}/${id}/tail/release`, {});
  }

  /** …and says it did not, which pauses the sale and asks for a statement. */
  denyOrder(id: string, orderId: number): Observable<SaleProgress> {
    return this.http.post<SaleProgress>(`${this.base}/${id}/orders/${orderId}/deny`, {});
  }

  /**
   * Sends the bank statement that settles a denied order.
   *
   * No `Content-Type` is set by hand: the browser has to add the multipart
   * boundary, and setting it here produces a body the server cannot parse.
   *
   * Answers with the progress snapshot whatever the statement turned out to
   * say — accepted, refused, or contradicting the seller are all ordinary
   * outcomes the screen renders rather than errors.
   */
  uploadStatement(id: string, orderId: number, file: File): Observable<SaleProgress> {
    const form = new FormData();
    form.append('file', file);

    return this.http.post<SaleProgress>(
      `${this.base}/${id}/orders/${orderId}/statement`,
      form,
    );
  }
}
