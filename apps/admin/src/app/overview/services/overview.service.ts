import { inject, Injectable } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { OverviewApiService } from './overview.api.service';

/**
 * The landing screen's figures.
 *
 * Not in the store, for the same reason the user detail page is not: one reader,
 * no live stream of its own, and nothing else in the app needs it. A resource
 * gives loading and error without either being tracked by hand.
 *
 * It is refetched on demand rather than pushed. The backend deliberately does
 * not recompute eleven aggregations on every write — see the note on
 * `AdminOverviewService` — so a "refresh" button is the honest interface.
 */
@Injectable({ providedIn: 'root' })
export class OverviewService {
  private readonly api = inject(OverviewApiService);

  private readonly resource = rxResource({ stream: () => this.api.load() });

  readonly overview = this.resource.value;
  readonly loading = this.resource.isLoading;
  readonly error = this.resource.error;

  reload(): void {
    this.resource.reload();
  }
}
