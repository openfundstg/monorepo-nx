import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ERROR, type CreateSaleReq } from '@transacto/contracts';
import { ApiErrorService } from '../../shared/services/api-error.service';
import { MetaPixelService } from '../../shared/services/meta-pixel.service';
import { PixelStandardEvent } from '../../shared/enums/pixel-event.enum';
import { TmaService } from '../../auth/services/tma.service';
import { SalePricingService } from './sale-pricing.service';
import { SaleService } from './sale.service';

/**
 * Turning a filled-in sale form into a sale — the half both forms share.
 *
 * **The two forms ask for different things and then do the same thing with the
 * answers.** One collects a jar link and a remainder policy, the other a card
 * number and a name; from the tap onwards they were identical, and identically
 * written twice: guard on validity, freeze the button, post, report the
 * conversion, buzz, navigate — and on failure, translate the code, buzz, and
 * re-read the rate if the market moved under the quote.
 *
 * That last branch is the reason this is worth extracting rather than tolerating.
 * It is not boilerplate: a form left holding the rate it was just refused for
 * goes on deriving the same stale target, and every further tap fails the same
 * way. One copy of that recovery is one place it can be got right.
 *
 * Route-scoped like {@link SalePricingService} and for the same reason: it holds
 * one form's state, and two forms opened one after another must not inherit each
 * other's error.
 */
@Injectable()
export class SaleSubmitService {
  private readonly router = inject(Router);
  private readonly apiError = inject(ApiErrorService);
  private readonly metaPixel = inject(MetaPixelService);
  private readonly saleService = inject(SaleService);
  private readonly tma = inject(TmaService);
  private readonly pricing = inject(SalePricingService);

  /** The request is in flight; the button is frozen and shows a spinner. */
  readonly submitting = signal(false);

  /** Already translated — `ApiErrorService` turns the code into the user's language. */
  readonly errorMsg = signal('');

  /**
   * Creates the sale the form describes, and goes to its status page.
   *
   * `build` is called only once the submission is going ahead, so a form need
   * not assemble a request it may not send. Returns nothing: everything a
   * screen has to react to is on the two signals above and on the pricing
   * service's `rateChange`.
   *
   * **A form says where the money goes; the price is added here.** The total,
   * the stake and the rate both were worked out at come from
   * {@link SalePricingService} and nowhere else, so neither form can send a
   * total priced one way beside a stake priced another — which the server
   * refuses outright, rather than guessing which of the two was meant.
   */
  async submit(
    build: () => Omit<CreateSaleReq, 'fiatAmount' | 'stakeCents' | 'quotedRate'>,
  ): Promise<void> {
    if (this.submitting()) return;

    const request: CreateSaleReq = {
      ...build(),
      fiatAmount: this.pricing.targetKopecks(),
      stakeCents: this.pricing.stakeCents(),
      // The rate every figure on the form was worked out at. The server refuses
      // a quote at any other rather than freezing a stake the screen never
      // showed.
      quotedRate: this.pricing.sellRateKopecks(),
    };
    this.submitting.set(true);
    this.errorMsg.set('');

    try {
      const result = await this.saleService.create(request);

      // The stake is frozen by the time this resolves, so the step is real
      // rather than an intention. The completion that follows — if it does — is
      // reported separately, from the status page.
      this.metaPixel.trackConversion(PixelStandardEvent.INITIATE_CHECKOUT, request.fiatAmount);
      this.tma.hapticFeedback('success');
      await this.router.navigate(['/sale', result.saleId, 'status']);
    } catch (error: unknown) {
      console.error('Failed to create sale:', error);
      this.errorMsg.set(this.apiError.messageFor(error));
      this.tma.hapticFeedback('error');

      // Refusing a moved quote is right — a stake must not be frozen at a rate
      // the user was never shown. Leaving the screen holding the refused rate
      // is not: the form would derive the same stale figures and the next tap
      // would fail identically. So the rate is re-read, which recomputes every
      // figure and reports what moved — and that report says more than this
      // code's sentence can, so the sentence steps aside for it. It stays only
      // when the re-read found nothing new to report: the rate moved and moved
      // back between the two requests, or the re-read failed outright.
      if (this.apiError.codeOf(error) === ERROR.SALE.RATE_CHANGED.code) {
        await this.pricing.load();

        // Measured against the rate the refused request quoted rather than the
        // one the form holds by now: a background re-read may have landed while
        // the request was out, and its report is the one on screen.
        const reported =
          this.pricing.sellRateKopecks() !== request.quotedRate &&
          this.pricing.rateChange() !== null;
        if (reported) this.errorMsg.set('');
      }
    } finally {
      this.submitting.set(false);
    }
  }
}
