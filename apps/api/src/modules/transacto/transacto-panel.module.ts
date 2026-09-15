import { HttpStatus, Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import environments from 'src/environments'
import { TransactoPanelApiService } from 'src/modules/transacto/services/transacto-panel.api.service'
import { TransactoPanelSessionApiService } from 'src/modules/transacto/services/transacto-panel-session.api.service'
import { TransactoPanelPayoutsApiService } from 'src/modules/transacto/services/transacto-panel-payouts.api.service'

/**
 * How the panel's browser identifies itself, copied from the captures the
 * contract was written from.
 *
 * Not decoration. This host sits behind Cloudflare, and a PHP operator UI
 * receiving `axios/1.18.1` from a datacentre address is two signals, not one —
 * the proxy only fixes the address. We are automating our own account, so the
 * honest thing is to look like the browser that account uses.
 *
 * **`Accept-Encoding` deliberately omits `zstd`**, which the real browser
 * advertises and Cloudflare does serve. Node decodes gzip, deflate and br;
 * a zstd body would arrive as unreadable bytes and every table would parse as
 * zero rows.
 */
const PANEL_BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/152.0.0.0 Safari/537.36',
  'Accept-Language': 'uk,uk-UA;q=0.9,en-US;q=0.8,en;q=0.7,ru;q=0.6',
  'Accept-Encoding': 'gzip, deflate, br'
} as const

/**
 * A separate module from `TransactoModule` because the panel needs a separate
 * axios instance, and the two disagree about the settings that matter.
 *
 * `TransactoModule` points at the Trader REST API and follows up to five
 * redirects. Those defaults are wrong here in a way that is silent: the panel
 * answers an expired session with `302 → /login`, so following it turns an
 * authentication failure into `200 text/html`, out of which `rate` reads as
 * `undefined`. Pinning `maxRedirects: 0` on the client makes that structural —
 * every call gets it, including ones written later by someone who has not read
 * this comment.
 *
 * `validateStatus` then lets the `302` come back as an ordinary response rather
 * than a throw, because it is expected roughly monthly and is the one failure
 * the service can actually repair.
 *
 * **`proxy: false` does not mean "no proxy".** It switches off axios's own
 * proxying, which reads `HTTP_PROXY` out of the environment and tunnels HTTPS
 * badly; the agent is attached per request by `TransactoPanelSessionApiService`
 * instead, so a rotation takes effect on the next call without rebuilding this
 * client.
 */
@Module({
  imports: [
    HttpModule.register({
      baseURL: environments.TRANSACTO_PANEL_BASE_URL,
      timeout: 10_000,
      maxRedirects: 0,
      validateStatus: (status: number) => status === HttpStatus.OK || status === HttpStatus.FOUND,
      headers: PANEL_BROWSER_HEADERS,
      proxy: false
    })
  ],
  providers: [
    TransactoPanelApiService,
    TransactoPanelSessionApiService,
    TransactoPanelPayoutsApiService
  ],
  exports: [
    TransactoPanelApiService,
    TransactoPanelSessionApiService,
    TransactoPanelPayoutsApiService
  ]
})
export class TransactoPanelModule {}
