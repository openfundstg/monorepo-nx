import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import {
  PageHeaderComponent,
  StatCardComponent,
  StatusChipComponent,
} from '../../../shared/components';
import { disputedSalesLink, saleTone } from '../../../shared/utils';
import type { NavTarget } from '../../../shared/interfaces';
import {
  formatNumber,
  formatUah,
  formatUsdt,
  formatUsdtWhole,
} from '../../../shared/utils/format.util';
import { OverviewService } from '../../services/overview.service';
import { TmaSaleStatus } from '@transacto/contracts';

/**
 * The first screen an operator opens.
 *
 * Figures are formatted here rather than by the card, because the four units in
 * play — UAH kopecks, USDT cents, whole USDT and plain counts — are not
 * interchangeable and the choice belongs next to the field it applies to.
 */
@Component({
  selector: 'app-overview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    TranslatePipe,
    PageHeaderComponent,
    StatCardComponent,
    StatusChipComponent,
  ],
  templateUrl: './overview.component.html',
  styleUrl: './overview.component.scss',
})
export class OverviewComponent {
  private readonly overviewService = inject(OverviewService);

  readonly overview = this.overviewService.overview;
  readonly loading = this.overviewService.loading;

  protected readonly formatUah = formatUah;
  protected readonly formatUsdt = formatUsdt;
  protected readonly formatUsdtWhole = formatUsdtWhole;
  protected readonly formatNumber = formatNumber;
  protected readonly saleTone = saleTone;

  /**
   * Where each figure's rows are.
   *
   * Built once rather than per render: a new object in a template expression is
   * a new reference on every change detection, which `OnPush` will happily
   * re-render forever.
   */
  protected readonly to = {
    users: { commands: ['/users'] },
    sales: { commands: ['/sales'] },
    deposits: { commands: ['/deposits'] },
    terminals: { commands: ['/terminals'] },
    alerts: { commands: ['/alerts'] },
    // A `RowLink` is a `NavTarget` with a chip on it, so the shared builder
    // fits here unchanged — and the dispute chip and this card then agree on
    // what "disputed" selects.
    disputes: disputedSalesLink(),
  } as const satisfies Readonly<Record<string, NavTarget>>;

  /**
   * The status breakdown as an ordered list, skipping statuses with no orders.
   *
   * Ordered by the enum rather than by count, so the row does not reshuffle
   * itself every time a figure moves — a breakdown that reorders is one nobody
   * can read at a glance.
   */
  readonly statusCounts = computed(() => {
    const byStatus = this.overview()?.sales.byStatus ?? {};

    return Object.values(TmaSaleStatus)
      .map((status) => ({ status, count: byStatus[status] ?? 0 }))
      .filter((entry) => entry.count > 0);
  });

  refresh(): void {
    this.overviewService.reload();
  }
}
