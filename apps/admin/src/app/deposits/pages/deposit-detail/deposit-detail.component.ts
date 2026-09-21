import { ChangeDetectionStrategy, Component, effect, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { AdminDepositKind } from '@transacto/contracts';
import { DocumentRowComponent, StatusChipComponent } from '../../../shared/components';
import { DateTimePipe, UahPipe, UsdtPipe } from '../../../shared/pipes';
import { depositRowTone, depositStatusPrefix } from '../../../shared/utils';
import { DepositDetailService } from '../../services/deposit-detail.service';

/**
 * One deposit, with the payer and every document sent about it.
 *
 * **This is the only screen that shows the recipient card**, and deliberately:
 * an operator reconciling a hryvnia top-up is looking at the same payout in
 * Transacto's own panel, and a masked number matches nothing — while a card in
 * a table nobody reads it from is a payment credential on screen for no errand
 * at all.
 */
@Component({
  selector: 'app-deposit-detail',
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
  templateUrl: './deposit-detail.component.html',
  styleUrl: './deposit-detail.component.scss',
})
export class DepositDetailComponent {
  /** Both route parameters, bound by the router. */
  readonly kind = input.required<AdminDepositKind>();
  readonly id = input.required<string>();

  private readonly deposits = inject(DepositDetailService);

  readonly detail = this.deposits.detail;
  readonly loading = this.deposits.loading;

  protected readonly depositRowTone = depositRowTone;
  protected readonly depositStatusPrefix = depositStatusPrefix;
  protected readonly DepositKind = AdminDepositKind;

  constructor() {
    effect(() => this.deposits.load(this.kind(), this.id()));
  }
}
