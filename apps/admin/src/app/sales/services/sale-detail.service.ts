import { inject, Injectable, signal, type Signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import type { AdminSaleDetailRes } from '@transacto/contracts';
import { SalesApiService } from './sales.api.service';

/**
 * One sale's page.
 *
 * Deliberately not in the store, for the reason `UsersService` gives: the list
 * is shared, live-patched and read by two screens, while one sale's page has a
 * single reader and is thrown away when it closes. Four files to hold a value
 * with one reader is ceremony.
 *
 * It does reload after an intervention, because an operator who has just
 * cancelled a sale is looking at the figures that moved.
 */
@Injectable({ providedIn: 'root' })
export class SaleDetailService {
  private readonly api = inject(SalesApiService);

  /**
   * `undefined` params, not `null`.
   *
   * A resource skips its loader entirely while `params` is `undefined`, which
   * is what makes the first render — before the route input has been read —
   * cost no request. `null` would be a value, and the loader would run with it.
   */
  private readonly saleId = signal<string | undefined>(undefined);

  private readonly resource = rxResource({
    params: () => this.saleId(),
    stream: ({ params }) => this.api.detail(params),
  });

  readonly detail: Signal<AdminSaleDetailRes | undefined> = this.resource.value;
  readonly loading = this.resource.isLoading;
  readonly error = this.resource.error;

  load(saleId: string): void {
    this.saleId.set(saleId);
  }

  reload(): void {
    this.resource.reload();
  }
}
