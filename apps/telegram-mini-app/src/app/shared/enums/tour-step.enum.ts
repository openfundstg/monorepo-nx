/**
 * The stops on the onboarding tour, in the order the dashboard lays them out.
 *
 * Values equal the member names so a dictionary key can be built from one —
 * `'tour.steps.' + step + '.title'` — the same way `SALE_EVENT.*` and
 * `fiat.status.*` are built. Lives in `shared/` because the bottom nav, which
 * is `shared/` and may import nothing from a feature, has to name one.
 */
export enum TourStep {
  WELCOME = 'WELCOME',
  BALANCE = 'BALANCE',
  TRUST = 'TRUST',
  DEPOSIT = 'DEPOSIT',
  SELL = 'SELL',
  ACTIVITY = 'ACTIVITY',
  NAV = 'NAV'
}
