import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type {
  BankProvider,
  CancelSaleRes,
  CreateSaleResponse,
  ResolveDropLinkRes,
  SaleConfigResponse,
  SaleProgress,
  TmaSale,
} from '@transacto/contracts';
import { SaleApiService, type CreateSaleReq } from './sale.api.service';

@Injectable({ providedIn: 'root' })
export class SaleService {
  private readonly api = inject(SaleApiService);

  getConfig(): Promise<SaleConfigResponse> {
    return firstValueFrom(this.api.getConfig());
  }

  create(req: CreateSaleReq): Promise<CreateSaleResponse> {
    return firstValueFrom(this.api.create(req));
  }

  /** See {@link SaleApiService.resolveLink}. */
  resolveLink(bankType: BankProvider, link: string): Promise<ResolveDropLinkRes> {
    return firstValueFrom(this.api.resolveLink({ bankType, link }));
  }

  /** See {@link SaleApiService.cancel}. */
  cancel(id: string): Promise<CancelSaleRes> {
    return firstValueFrom(this.api.cancel(id));
  }

  async list(): Promise<TmaSale[]> {
    const { orders } = await firstValueFrom(this.api.list());
    return orders;
  }

  async getById(id: string): Promise<TmaSale> {
    const { order } = await firstValueFrom(this.api.getById(id));
    return order;
  }

  /**
   * The order's live progress snapshot.
   *
   * Unwrapped deliberately: `GET /sales/:id/progress` returns the
   * `SaleProgress` at the top level, identical to the WS push, so the
   * status page can feed both into the same signal without a shape check.
   */
  getProgress(id: string): Promise<SaleProgress> {
    return firstValueFrom(this.api.getProgress(id));
  }

  /** See {@link SaleApiService.confirmOrder}. */
  confirmOrder(id: string, orderId: number, receivedAmount?: number): Promise<SaleProgress> {
    return firstValueFrom(this.api.confirmOrder(id, orderId, receivedAmount));
  }

  /** See {@link SaleApiService.denyOrder}. */
  denyOrder(id: string, orderId: number): Promise<SaleProgress> {
    return firstValueFrom(this.api.denyOrder(id, orderId));
  }

  /** See {@link SaleApiService.confirmTail}. */
  confirmTail(id: string): Promise<SaleProgress> {
    return firstValueFrom(this.api.confirmTail(id));
  }

  /** See {@link SaleApiService.releaseTail}. */
  releaseTail(id: string): Promise<SaleProgress> {
    return firstValueFrom(this.api.releaseTail(id));
  }

  /** See {@link SaleApiService.uploadStatement}. */
  uploadStatement(id: string, orderId: number, file: File): Promise<SaleProgress> {
    return firstValueFrom(this.api.uploadStatement(id, orderId, file));
  }
}
