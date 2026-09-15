import { ChangeDetectionStrategy, Component, signal, inject, OnInit, computed } from '@angular/core'
import { Router } from '@angular/router'
import { FormsModule } from '@angular/forms'
import { Store } from '@ngrx/store'
import { TranslatePipe } from '@ngx-translate/core'
import { MIN_USDT_AMOUNT } from '@transacto/contracts'
import { selectSellRate } from '../../../core/store/rates.selectors'
import { DepositService } from '../../services/deposit.service'
import { ApiErrorService } from '../../../shared/services/api-error.service'
import { TmaService } from '../../../auth/services/tma.service'
import { MetaPixelService } from '../../../shared/services/meta-pixel.service'
import { PixelStandardEvent } from '../../../shared/enums/pixel-event.enum'

@Component({
  selector: 'app-deposit-create',
  imports: [FormsModule, TranslatePipe],
  templateUrl: './deposit-create.component.html',
  styleUrl: './deposit-create.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DepositCreateComponent implements OnInit {
  private readonly router = inject(Router)
  private readonly depositService = inject(DepositService)
  private readonly tma = inject(TmaService)
  private readonly apiError = inject(ApiErrorService)
  private readonly metaPixel = inject(MetaPixelService)
  private readonly store = inject(Store)

  /** Exposed so the template names the same figure the server enforces. */
  protected readonly MIN_USDT_AMOUNT = MIN_USDT_AMOUNT

  readonly cryptoAmount = signal(0)
  readonly errorMsg = signal('')
  /**
   * Set when the config call could not hand us a rate.
   *
   * There is no fallback figure to fall back to — the server refuses to quote a
   * price it cannot fetch, and inventing one here would be the same mistake one
   * layer out. So the screen says so and stops, instead of quietly showing ₴0.
   */
  readonly rateUnavailable = signal(false)
  readonly submitting = signal(false)

  /**
   * Kopecks per USDT for the line under the field, from the polled slice.
   *
   * The **sell** rate, and read from the store rather than from this screen's
   * own config call — which is what it used to do, and why this was the one
   * place still quoting a bare market price. Nothing here is priced at it: a
   * chain transfer credits the USDT it carried, one for one. The figure answers
   * "what is this worth", and in this product that is what it sells for — the
   * same number the dashboard's sell button shows, rather than a third one the
   * user meets nowhere else.
   */
  private readonly sellRate = this.store.selectSignal(selectSellRate)

  readonly fiatEquivalent = computed(() =>
    Math.round(this.cryptoAmount() * (this.sellRate() ?? 0))
  )

  /**
   * Whether there is a price to quote at all.
   *
   * `null` until the first poll answers, which is a second or two on a cold
   * start — and "≈ 0,00 грн" under a hundred USDT is worse than no line.
   */
  readonly hasRate = computed(() => (this.sellRate() ?? 0) > 0)

  /** Below the floor the backend will refuse anyway — say so before the trip. */
  readonly belowMinimum = computed(() => this.cryptoAmount() < MIN_USDT_AMOUNT)

  async ngOnInit() {
    // Back to the chooser, not to the dashboard: this screen is now one of two
    // branches, and skipping past the fork strands anyone who took the wrong one.
    this.tma.showBackButton(() => this.router.navigate(['/deposit']))
    await this.loadConfig()
  }

  /** Also the retry handler, so a passing outage costs one tap. */
  async loadConfig(): Promise<void> {
    this.rateUnavailable.set(false)
    try {
      // Asked for what it still decides — whether the server can price a
      // deposit at all. The rate it returns is not read: a market figure this
      // screen shows nowhere.
      await this.depositService.getConfig()
    } catch (err) {
      console.error('Failed to load deposit config:', err)
      this.rateUnavailable.set(true)
    }
  }

  onAmountChange() {
    // Signal is already updated via ngModel
  }

  async onSubmit() {
    if (this.belowMinimum() || this.submitting() || this.rateUnavailable()) return

    this.submitting.set(true)
    this.errorMsg.set('')

    try {
      const result = await this.depositService.create(this.cryptoAmount())
      // Reported in hryvnia, not USDT: `currency` wants ISO 4217 and Meta has
      // never heard of USDT, so the figure is the same one the screen shows.
      this.metaPixel.trackConversion(
        PixelStandardEvent.ADD_PAYMENT_INFO,
        this.fiatEquivalent()
      )
      this.tma.hapticFeedback('success')
      this.router.navigate(['/deposit', result.depositId, 'verify'])
    } catch (err: unknown) {
      // Was logged to the console and nothing else, so a refused deposit simply
      // did nothing on screen and the user had no idea why.
      this.errorMsg.set(this.apiError.messageFor(err))
      this.tma.hapticFeedback('error')
    } finally {
      this.submitting.set(false)
    }
  }

  formatUah(kopecks: number): string {
    return (kopecks / 100).toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
}
