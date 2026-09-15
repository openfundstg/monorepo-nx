import { inject, Injectable, signal, type Signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import type { AdminTmaUserDetailRes } from '@transacto/contracts';
import { UsersApiService } from './users.api.service';

/**
 * The detail page's state.
 *
 * Deliberately not in the store. The list is in NgRx because it is shared —
 * live pushes patch it, the paging survives navigation, and two screens read
 * it. One user's detail page is read by exactly one component, is thrown away
 * when it closes, and has no live stream of its own; putting it in the store
 * would be four files to hold a value with one reader.
 */
@Injectable({ providedIn: 'root' })
export class UsersService {
  private readonly api = inject(UsersApiService);

  private readonly telegramId = signal<number | undefined>(undefined);

  /**
   * Re-requests whenever {@link load} is given a different id, and exposes
   * loading and error without either being tracked by hand.
   */
  /**
   * `undefined` params, not `null`.
   *
   * A resource skips its loader entirely while `params` is `undefined`, which
   * is what makes the first render — before the route input has been read —
   * cost no request. `null` would be a value, and the loader would run with it.
   */
  private readonly resource = rxResource({
    params: () => this.telegramId(),
    stream: ({ params }) => this.api.detail(params),
  });

  readonly detail: Signal<AdminTmaUserDetailRes | undefined> = this.resource.value;
  readonly loading = this.resource.isLoading;
  readonly error = this.resource.error;

  load(telegramId: number): void {
    this.telegramId.set(telegramId);
  }

  /** After a correction, so the figures on screen are the ones just written. */
  reload(): void {
    this.resource.reload();
  }
}
