import { DestroyRef, inject, Injectable, signal, type Signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { processHistoryLog, type HistoryLog } from '@transacto/history-table';
import { AdminSocketService } from '../../core/services/admin-socket.service';
import { TerminalsApiService } from './terminals.api.service';

/** How many rows the screen loads. The extension shows the same fixed window. */
const HISTORY_LIMIT = 100;

/**
 * One jar's scraping history, live.
 *
 * Not in the store, for the reason the overview and the user detail page are
 * not: one reader, and it is thrown away when the screen closes. The terminals
 * *list* is in NgRx because balances are pushed into it from anywhere in the
 * app; a single jar's audit trail is read by exactly one screen.
 *
 * It is deliberately **not paged**. The extension shows a fixed window of the
 * most recent rows, and this table is the same component showing the same
 * thing — a paginator here would make the two look different, which is the one
 * thing the shared component exists to prevent. New rows arrive at the top.
 */
@Injectable({ providedIn: 'root' })
export class TerminalHistoryService {
  private readonly api = inject(TerminalsApiService);
  private readonly socket = inject(AdminSocketService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly cardId = signal<number | null>(null);
  private readonly rows = signal<readonly HistoryLog[]>([]);
  private readonly busy = signal(false);

  readonly logs: Signal<readonly HistoryLog[]> = this.rows.asReadonly();
  readonly loading = this.busy.asReadonly();

  constructor() {
    this.socket
      .terminalHistoryAppended()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((update) => {
        // The stream carries every terminal's rows; this screen wants one.
        if (Number(update.cardId) !== this.cardId()) return;

        const processed = processHistoryLog(update);
        // Marks the row so the shared table can animate it in — the same flag
        // the extension sets, rendered by the same stylesheet.
        processed.isNew = true;
        this.rows.update((rows) => [processed, ...rows]);
      });
  }

  async load(cardId: number): Promise<void> {
    this.cardId.set(cardId);
    this.busy.set(true);

    try {
      const page = await this.api.history(cardId, { page: 1, limit: HISTORY_LIMIT });
      // Mapped through the same helper the extension's loader uses, so a row
      // fetched and a row pushed are shaped identically.
      this.rows.set(page.items.map((item) => processHistoryLog(item)));
    } finally {
      this.busy.set(false);
    }
  }
}
