import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatPaginatorModule, type PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { AdminSortDirection, type ApiError } from '@transacto/contracts';
import { ChipTone } from '../../enums/chip-tone.enum';
import { ColumnType } from '../../enums/column-type.enum';
import type { ColumnDef, RowAction, RowLink } from '../../interfaces/column-def.interface';
import {
  formatDateTime,
  formatNumber,
  formatUah,
  formatUsdt,
  formatUsdtWhole,
} from '../../utils/format.util';
import { StatusChipComponent } from '../status-chip/status-chip.component';

/** What a row action emits — which action, on which row. */
export interface RowActionEvent<T> {
  readonly actionId: string;
  readonly row: T;
}

/**
 * Every list in the panel.
 *
 * Driven by `ColumnDef[]` rather than a template per screen, which is what
 * keeps every list to one implementation of paging, sorting, the loading bar,
 * the empty state and the live-rows notice. A screen supplies its columns and
 * its actions; it does not supply a `<table>`.
 *
 * Two of the column types exist so a row can be *followed* rather than copied
 * out of: `ROUTER_LINK` turns a cell's own value into a link, and `REFS` puts
 * several small links in one cell — one cell and not four columns, because
 * which links a row has depends on what kind of row it is, and a column per
 * possibility is a table of empty cells.
 *
 * It is deliberately presentational: it holds no state, fetches nothing, and
 * reports what the operator did. The NgRx collection behind it owns the query,
 * so the table cannot end up showing page three of a filter the store thinks is
 * on page one.
 */
@Component({
  selector: 'app-collection-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    MatTableModule,
    MatPaginatorModule,
    MatProgressBarModule,
    MatIconModule,
    MatButtonModule,
    MatMenuModule,
    MatTooltipModule,
    TranslatePipe,
    StatusChipComponent,
  ],
  templateUrl: './collection-table.component.html',
  styleUrl: './collection-table.component.scss',
})
export class CollectionTableComponent<T> {
  readonly columns = input.required<readonly ColumnDef<T>[]>();
  readonly rows = input.required<readonly T[]>();
  readonly total = input.required<number>();
  readonly page = input.required<number>();
  readonly limit = input.required<number>();
  readonly loading = input(false);
  readonly error = input<ApiError | null>(null);
  readonly sort = input<string | null>(null);
  readonly direction = input<AdminSortDirection>(AdminSortDirection.DESC);
  /** Rows that arrived live and do not belong on screen — see `CollectionState`. */
  readonly pendingCount = input(0);
  readonly actions = input<readonly RowAction<T>[]>([]);
  /** Translation key shown when the list is genuinely empty. */
  readonly emptyMessage = input('common.empty');
  /**
   * How a row identifies itself — the collection's own `idOf`.
   *
   * **Required in practice**, and the reason it exists is a bug rather than a
   * preference. This used to track by the *first column's value*, on a comment
   * claiming that column was always an id. It was an id on three lists out of
   * thirteen: the rest lead with `createdAt`, a terminal name or a person's
   * display name, none of which is unique. Two rows sharing one — two receipts
   * uploaded in the same millisecond, two jars named the same thing, two people
   * called the same thing — track as one row, and a live push then updates
   * whichever of them the differ happened to pair it with.
   */
  readonly rowId = input<((row: T) => string) | null>(null);

  readonly pageChange = output<{ page: number; limit: number }>();
  readonly sortChange = output<{ sort: string; direction: AdminSortDirection }>();
  readonly rowAction = output<RowActionEvent<T>>();
  readonly refresh = output<void>();

  /** Exposed for the template, which cannot reach a module-scope import. */
  protected readonly ColumnType = ColumnType;
  protected readonly ChipTone = ChipTone;

  /** Material needs the trailing actions pseudo-column named alongside the real ones. */
  readonly displayedColumns = computed(() => {
    const keys = this.columns().map((column) => column.key);

    return this.actions().length > 0 ? [...keys, ACTIONS_COLUMN] : keys;
  });

  protected readonly actionsColumn = ACTIONS_COLUMN;

  /** Material's paginator is zero-based; the API is not. */
  readonly pageIndex = computed(() => Math.max(0, this.page() - 1));

  onPage(event: PageEvent): void {
    this.pageChange.emit({ page: event.pageIndex + 1, limit: event.pageSize });
  }

  /**
   * Clicking a sortable header cycles descending → ascending → descending.
   *
   * Two states, not three: a list with no sort at all has no useful meaning
   * here — the server always orders by something — so "off" would just be a
   * third click that silently reverts to the default.
   */
  onSort(column: ColumnDef<T>): void {
    if (!column.sortable) return;

    const isCurrent = this.sort() === column.key;
    const next =
      isCurrent && this.direction() === AdminSortDirection.DESC
        ? AdminSortDirection.ASC
        : AdminSortDirection.DESC;

    this.sortChange.emit({ sort: column.key, direction: next });
  }

  sortIcon(column: ColumnDef<T>): string {
    if (!column.sortable || this.sort() !== column.key) return '';

    return this.direction() === AdminSortDirection.ASC ? 'arrow_upward' : 'arrow_downward';
  }

  /** Actions a given row actually offers — hidden, never shown disabled. */
  visibleActions(row: T): readonly RowAction<T>[] {
    return this.actions().filter((action) => !action.visible || action.visible(row));
  }

  /**
   * The formatted cell.
   *
   * The single `switch` that decides how a value is drawn, which is the whole
   * reason columns are described rather than templated: kopecks cannot be
   * rendered as cents on one screen and hryvnia on another when there is only
   * one place that renders them.
   */
  cell(column: ColumnDef<T>, row: T): string {
    const value = column.value(row);
    if (value === null || value === undefined || value === '') return EM_DASH;

    switch (column.type) {
      case ColumnType.UAH:
        return formatUah(Number(value));
      case ColumnType.USDT:
        return formatUsdt(Number(value));
      case ColumnType.USDT_WHOLE:
        return formatUsdtWhole(Number(value));
      case ColumnType.NUMBER:
        return formatNumber(Number(value));
      case ColumnType.DATE:
        return formatDateTime(String(value));
      default:
        return String(value);
    }
  }

  /**
   * The prefix a chip builds its translation key from.
   *
   * A function where the enum depends on the row — the deposits book carries
   * two status enums in one column, discriminated by the row's rail, and the
   * archive does the same with two document verdicts. A fixed string would
   * force a third enum flattening both, which is a status written down in three
   * places and agreeing in two.
   */
  prefixFor(column: ColumnDef<T>, row: T): string | null {
    const prefix = column.translatePrefix;
    if (prefix === undefined) return null;

    return typeof prefix === 'function' ? prefix(row) : prefix;
  }

  linkFor(column: ColumnDef<T>, row: T): RowLink | null {
    return column.link ? column.link(row) : null;
  }

  refsFor(column: ColumnDef<T>, row: T): readonly RowLink[] {
    return column.refs ? column.refs(row) : [];
  }

  chipTone(column: ColumnDef<T>, row: T): ChipTone {
    return column.tone ? column.tone(row) : ChipTone.NEUTRAL;
  }

  boolTone(column: ColumnDef<T>, row: T): ChipTone {
    return column.value(row) ? ChipTone.POSITIVE : ChipTone.NEUTRAL;
  }

  boolLabel(column: ColumnDef<T>, row: T): string {
    return column.value(row) ? 'common.yes' : 'common.no';
  }

  /**
   * Row identity, from the collection that owns the rows.
   *
   * Falls back to the index when no `rowId` is supplied. That is a worse
   * identity — every row re-renders on every push — but it is a *safe* one,
   * where guessing from a column silently pairs two different rows. Losing
   * render work is recoverable; showing one row's figures under another row's
   * id is not.
   */
  trackRow = (index: number, row: T): string => {
    const id = this.rowId();

    return id ? id(row) : String(index);
  };
}

/** The trailing column Material needs named, even though nothing defines it. */
const ACTIONS_COLUMN = '__actions';

const EM_DASH = '—';
