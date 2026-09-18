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
   * The market moved between the quote and the submit.
   *
   * Its own flag rather than part of {@link errorMsg} because the screen does
   * more than say so: the jar form offers the recomputed amount as a tap.
   */
  readonly rateMoved = signal(false);

  /**
   * Creates the sale the form describes, and goes to its status page.
   *
   * `build` is called only once the submission is going ahead, so a form need
   * not assemble a request it may not send. Returns nothing: everything a
   * screen has to react to is on the three signals above.
   */
  async submit(build: () => CreateSaleReq): Promise<void> {
    if (this.submitting()) return;

    const amountKopecks = this.pricing.targetKopecks();
    this.submitting.set(true);
    this.errorMsg.set('');

    try {
      const result = await this.saleService.create(build());

      // The stake is frozen by the time this resolves, so the step is real
      // rather than an intention. The completion that follows — if it does — is
      // reported separately, from the status page.
      this.metaPixel.trackConversion(PixelStandardEvent.INITIATE_CHECKOUT, amountKopecks);
      this.tma.hapticFeedback('success');
      await this.router.navigate(['/sale', result.saleId, 'status']);
    } catch (error: unknown) {
      console.error('Failed to create sale:', error);
      this.errorMsg.set(this.apiError.messageFor(error));
      this.tma.hapticFeedback('error');

      // Refusing a moved quote is right — a jar whose goal no longer matches can
      // never fill, and a stake must not be frozen against a target the server
      // never agreed. Leaving the screen holding the refused rate is not: the
      // form would derive the same stale target and the next tap would fail
      // identically. So the rate is re-read and the new amount offered.
      if (this.apiError.codeOf(error) === ERROR.SALE.RATE_CHANGED.code) {
        await this.pricing.load();
        this.rateMoved.set(true);
      }
    } finally {
      this.submitting.set(false);
    }
  }

  /** Cleared the moment the amount changes, so a stale refusal never outlives it. */
  clearRateMoved(): void {
    this.rateMoved.set(false);
  }
}
