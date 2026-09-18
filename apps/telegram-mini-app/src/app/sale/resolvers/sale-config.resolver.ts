import { inject } from '@angular/core';
import type { ResolveFn } from '@angular/router';
import type { SaleConfigResponse } from '@transacto/contracts';
import { SaleService } from '../services/sale.service';

/**
 * The figures a sale form is priced from, fetched before the form is drawn.
 *
 * **Because the alternative is a form that argues with itself for half a
 * second.** Loading in `ngOnInit` means the screen paints with the literals the
 * signals were declared with — a balance of 0.00, an allowance of zero, a rate
 * of nothing — and every rule derived from them is therefore false on that
 * first frame. The user does not see "loading"; they see a balance they do not
 * have and a red refusal, which are then replaced. A resolver moves the wait to
 * before the navigation, where the app already shows that it is working.
 *
 * `null` on failure rather than a rejection, deliberately. A resolver that
 * throws cancels the navigation, so a passing outage would leave the user on
 * the screen they came from with nothing said. The form renders instead, with
 * its "rate unavailable" line and a retry that costs one tap.
 */
export const saleConfigResolver: ResolveFn<SaleConfigResponse | null> = () =>
  inject(SaleService)
    .getConfig()
    .catch((error: unknown) => {
      console.error('Failed to resolve sale config:', error);

      return null;
    });

/** The key both forms read it back under. */
export const SALE_CONFIG_KEY = 'config';
