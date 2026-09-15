import { ChangeDetectionStrategy, Component, computed, effect, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { Store } from '@ngrx/store';
import { HistoryTableComponent } from '@transacto/history-table';
import { PageHeaderComponent } from '../../../shared/components';
import { AdminSocketService } from '../../../core/services/admin-socket.service';
import { terminalsCollection } from '../../store/terminals.collection';
import { TerminalHistoryService } from '../../services/terminal-history.service';

/**
 * One jar's scraping history, rendered by the table the extension uses.
 *
 * `@transacto/history-table` is the same component, the same columns and the
 * same badges a trader sees for their own terminal. Two copies of it would be
 * two implementations of the same six columns, and "identical" would survive
 * exactly until the first change to either.
 *
 * Everything around it is this app's: the terminal a trader sees is theirs and
 * needs no naming, whereas an operator arrives here from a list of everybody's
 * and needs to be told which one they are looking at.
 */
@Component({
  selector: 'app-terminal-history',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    MatIconModule,
    MatButtonModule,
    TranslatePipe,
    PageHeaderComponent,
    HistoryTableComponent,
  ],
  templateUrl: './terminal-history.component.html',
  styleUrl: './terminal-history.component.scss',
})
export class TerminalHistoryComponent {
  /** The route parameter, bound by the router. A string until it is parsed. */
  readonly cardId = input.required<string>();

  private readonly historyService = inject(TerminalHistoryService);
  private readonly socket = inject(AdminSocketService);
  private readonly store = inject(Store);

  readonly logs = this.historyService.logs;
  readonly loading = this.historyService.loading;
  /** Shown so "no new rows" can be told apart from "the socket dropped". */
  readonly connected = this.socket.connected;

  private readonly terminals = this.store.selectSignal(terminalsCollection.selectors.selectItems);

  /**
   * The terminal this history belongs to, if the list happens to hold it.
   *
   * `undefined` when the screen was opened directly by URL — the list's slice
   * is route-scoped, so arriving here without passing through it means there is
   * nothing to look up. The header falls back to the card id, which is the one
   * identifier that is always known.
   */
  readonly terminal = computed(() =>
    this.terminals().find((item) => item.cardId === Number(this.cardId())),
  );

  constructor() {
    // A side effect on a route input, writing no other signal.
    effect(() => void this.historyService.load(Number(this.cardId())));
  }
}
