import { ChangeDetectionStrategy, Component, computed, effect, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { AdminDocumentKind, SaleMethod } from '@transacto/contracts';
import { DocumentRowComponent, StatusChipComponent } from '../../../shared/components';
import { DateTimePipe, UahPipe, UsdtPipe } from '../../../shared/pipes';
import {
  cardOrderTone,
  documentRejectionKey,
  documentStatusPrefix,
  documentTone,
  flagTone,
  orderTone,
  saleTone,
} from '../../../shared/utils';
import { SaleDetailService } from '../../services/sale-detail.service';

/**
 * One sale, with everything attached to it on one screen.
 *
 * **The screen this panel was missing.** Working a complaint used to mean four
 * navigations — the seller in the users list, the terminal in the terminals
 * list, the order in a third screen, the document in a fourth — each of them a
 * chance to paste the wrong number into a search box. Here the sale is the
 * page, and everything around it is a link on it.
 *
 * The id arrives as a route input — `withComponentInputBinding()` is on — so
 * there is no `ActivatedRoute` subscription to leak and no `paramMap` to
 * re-read on a same-route navigation.
 */
@Component({
  selector: 'app-sale-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    MatIconModule,
    MatButtonModule,
    MatProgressBarModule,
    MatTooltipModule,
    TranslatePipe,
    StatusChipComponent,
    DocumentRowComponent,
    UahPipe,
    UsdtPipe,
    DateTimePipe,
  ],
  templateUrl: './sale-detail.component.html',
  styleUrl: './sale-detail.component.scss',
})
export class SaleDetailComponent {
  /** The route parameter, bound by the router. */
  readonly id = input.required<string>();

  private readonly sales = inject(SaleDetailService);

  readonly detail = this.sales.detail;
  readonly loading = this.sales.loading;

  readonly isCardSale = computed(() => this.detail()?.sale.saleMethod === SaleMethod.CARD);

  protected readonly saleTone = saleTone;
  protected readonly cardOrderTone = cardOrderTone;
  protected readonly orderTone = orderTone;
  protected readonly documentTone = documentTone;
  protected readonly flagTone = flagTone;
  protected readonly DocumentKind = AdminDocumentKind;

  /**
   * The statement summaries under each card order build their keys from the
   * same maps the shared row does — never from a literal prefix.
   *
   * Both were hard-coded strings that happened to be right here, which is the
   * kind of correct that stops being correct the first time a screen shows the
   * other kind of document.
   */
  protected readonly statementStatusPrefix = documentStatusPrefix(
    AdminDocumentKind.SALE_STATEMENT,
  );

  protected statementRejectionKey(rejection: string): string {
    return documentRejectionKey(AdminDocumentKind.SALE_STATEMENT, rejection);
  }

  constructor() {
    // An effect, because the input is a signal and the load is a side effect on
    // it. It never writes another signal — the resource owns its own state.
    effect(() => this.sales.load(this.id()));
  }
}
