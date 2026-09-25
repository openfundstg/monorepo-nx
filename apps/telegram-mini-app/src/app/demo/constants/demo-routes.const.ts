import { DemoEndpoint } from '../enums/demo-endpoint.enum'
import { DemoHttpMethod } from '../enums/demo-http-method.enum'
import type { DemoRoute } from '../interfaces/demo-route.interface'

const { GET, POST, PUT, PATCH, DELETE } = DemoHttpMethod

/**
 * Every endpoint the Mini App calls, and what a demo account does with it.
 *
 * **A request that matches nothing here is refused, not sent.** The server
 * refuses a demo account's writes anyway, but a read it answered would put a
 * real figure — a zero balance, an empty list — on a screen full of invented
 * ones, in the middle of somebody's recording. So the default is the safe
 * answer, and `demo-routes.const.spec.ts` fails for any endpoint an api
 * service calls that is not listed: somebody adding a screen has to decide
 * what the demo shows on it, rather than finding out from a video.
 *
 * Writes are listed as `REFUSED` explicitly, even though refusing is the
 * default, for the same reason — the spec can then tell "decided" from
 * "forgotten".
 */
export const DEMO_ROUTES: readonly DemoRoute[] = [
  // To the server: the launch, the live rates, and reading a pasted jar.
  { method: POST, path: '/auth', endpoint: DemoEndpoint.AUTH },
  { method: GET, path: '/rates', endpoint: DemoEndpoint.RATES },
  { method: POST, path: '/sales/resolve-link', endpoint: DemoEndpoint.RESOLVE_JAR_LINK },

  // From the pack.
  { method: GET, path: '/user/profile', endpoint: DemoEndpoint.PROFILE },
  { method: GET, path: '/user/balance-history', endpoint: DemoEndpoint.HISTORY },
  { method: GET, path: '/referral', endpoint: DemoEndpoint.REFERRAL },
  { method: GET, path: '/analytics/income', endpoint: DemoEndpoint.INCOME },
  { method: GET, path: '/trust-levels', endpoint: DemoEndpoint.TRUST_LADDER },
  { method: GET, path: '/sales/config', endpoint: DemoEndpoint.SALE_CONFIG },
  { method: GET, path: '/sales', endpoint: DemoEndpoint.SALE_LIST },
  { method: GET, path: '/sales/:id', endpoint: DemoEndpoint.SALE_DETAIL },
  { method: GET, path: '/sales/:id/progress', endpoint: DemoEndpoint.SALE_PROGRESS },
  { method: GET, path: '/deposits/config', endpoint: DemoEndpoint.DEPOSIT_CONFIG },
  { method: GET, path: '/deposits', endpoint: DemoEndpoint.DEPOSIT_LIST },
  { method: GET, path: '/deposits/:id', endpoint: DemoEndpoint.DEPOSIT_DETAIL },
  { method: GET, path: '/fiat-deposits/options', endpoint: DemoEndpoint.FIAT_OPTIONS },
  { method: GET, path: '/fiat-deposits/watch', endpoint: DemoEndpoint.FIAT_WATCH },
  { method: GET, path: '/fiat-deposits/active', endpoint: DemoEndpoint.FIAT_ACTIVE },
  { method: GET, path: '/fiat-deposits/:id', endpoint: DemoEndpoint.FIAT_DETAIL },

  // Acted out: the button works, a detail page opens, nothing leaves the phone.
  { method: POST, path: '/sales', endpoint: DemoEndpoint.SALE_CREATE },
  { method: POST, path: '/deposits', endpoint: DemoEndpoint.DEPOSIT_CREATE },
  { method: POST, path: '/fiat-deposits', endpoint: DemoEndpoint.FIAT_CREATE },

  // Refused: every other write.
  { method: POST, path: '/referral/redeem', endpoint: DemoEndpoint.REFUSED },
  { method: POST, path: '/referral/transfer', endpoint: DemoEndpoint.REFUSED },
  { method: PATCH, path: '/referral/name-visibility', endpoint: DemoEndpoint.REFUSED },
  { method: POST, path: '/sales/:id/cancel', endpoint: DemoEndpoint.REFUSED },
  { method: POST, path: '/sales/:id/tail/confirm', endpoint: DemoEndpoint.REFUSED },
  { method: POST, path: '/sales/:id/orders/:orderId/confirm', endpoint: DemoEndpoint.REFUSED },
  { method: POST, path: '/sales/:id/orders/:orderId/deny', endpoint: DemoEndpoint.REFUSED },
  { method: POST, path: '/sales/:id/orders/:orderId/statement', endpoint: DemoEndpoint.REFUSED },
  { method: POST, path: '/deposits/:id/verify-tx', endpoint: DemoEndpoint.REFUSED },
  { method: PUT, path: '/fiat-deposits/watch', endpoint: DemoEndpoint.REFUSED },
  { method: DELETE, path: '/fiat-deposits/watch', endpoint: DemoEndpoint.REFUSED },
  { method: POST, path: '/fiat-deposits/:id/receipts', endpoint: DemoEndpoint.REFUSED },
  { method: POST, path: '/fiat-deposits/:id/appeal', endpoint: DemoEndpoint.REFUSED },
  { method: POST, path: '/fiat-deposits/:id/cancel', endpoint: DemoEndpoint.REFUSED }
]
