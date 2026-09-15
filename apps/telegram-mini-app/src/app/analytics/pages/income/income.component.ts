import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import type { IncomeAnalyticsResponse } from '@transacto/contracts';
import { AnalyticsService } from '../../services/analytics.service';
import { TmaService } from '../../../auth/services/tma.service';
import { ApiErrorService } from '../../../shared/services/api-error.service';
import { UahPipe } from '../../../shared/pipes/uah.pipe';
import { UsdtPipe } from '../../../shared/pipes/usdt.pipe';

/**
 * What the user has earned here, and — kept apart from it — what they have
 * merely received.
 *
 * The two blocks are not a layout choice. Only one of them can be called
 * profit: USDT this product sold them has a hryvnia price we watched them pay,
 * and USDT they brought in from an exchange has a price we were never told. A
 * single blended figure would print a measurement and a guess in the same font,
 * and nothing on the screen could say which half was which.
 *
 * Realised only. USDT still on the balance appears nowhere: a number that moved
 * with the market rather than with anything the user did would change between
 * two glances at a page about what they earned.
 */
@Component({
  selector: 'app-income',
  imports: [TranslatePipe, UahPipe, UsdtPipe],
  templateUrl: './income.component.html',
  styleUrl: './income.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IncomeComponent implements OnInit, OnDestroy {
  private readonly analytics = inject(AnalyticsService);
  private readonly tma = inject(TmaService);
  private readonly apiError = inject(ApiErrorService);
  private readonly router = inject(Router);

  readonly income = signal<IncomeAnalyticsResponse | null>(null);
  readonly loading = signal(true);
  /**
   * What went wrong, in the user's language, or empty while nothing has.
   *
   * The server's own reason rather than one fixed sentence: a launch that has
   * aged out, a rate limit and a 500 are different things to be told, and
   * `ApiErrorService` is where every other screen in this app turns a
   * `{ code, message }` into words. A page that swallowed the code would be the
   * one screen outside that path, and a new `ERROR` code would never reach it.
   */
  readonly errorMsg = signal('');

  async ngOnInit(): Promise<void> {
    this.tma.showBackButton(() => this.router.navigate(['/']));
    await this.load();
  }

  ngOnDestroy(): void {
    this.tma.hideBackButton();
  }

  /** Also the retry handler, so a passing outage costs one tap. */
  async load(): Promise<void> {
    this.loading.set(true);
    this.errorMsg.set('');

    try {
      this.income.set(await this.analytics.getIncome());
    } catch (err: unknown) {
      this.errorMsg.set(this.apiError.messageFor(err, 'income.load_failed'));
    } finally {
      this.loading.set(false);
    }
  }
}
