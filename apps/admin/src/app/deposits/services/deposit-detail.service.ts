import { inject, Injectable, signal, type Signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import type { AdminDepositDetailRes, AdminDepositKind } from '@transacto/contracts';
import { DepositsApiService } from './deposits.api.service';

/** One deposit's page. Not in the store, for the reason `SaleDetailService` gives. */
@Injectable({ providedIn: 'root' })
export class DepositDetailService {
  private readonly api = inject(DepositsApiService);

  /** `undefined` while the route input has not been read — a resource then skips its loader. */
  private readonly target = signal<{ kind: AdminDepositKind; id: string } | undefined>(undefined);

  private readonly resource = rxResource({
    params: () => this.target(),
    stream: ({ params }) => this.api.detail(params.kind, params.id),
  });

  readonly detail: Signal<AdminDepositDetailRes | undefined> = this.resource.value;
  readonly loading = this.resource.isLoading;
  readonly error = this.resource.error;

  load(kind: AdminDepositKind, id: string): void {
    this.target.set({ kind, id });
  }

  reload(): void {
    this.resource.reload();
  }
}
