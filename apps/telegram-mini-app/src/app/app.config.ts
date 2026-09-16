import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideZonelessChangeDetection
} from '@angular/core'
import { NavigationError, provideRouter, withNavigationErrorHandler, withPreloading } from '@angular/router'
import { provideHttpClient, withInterceptors } from '@angular/common/http'
import { provideStore } from '@ngrx/store'
import { provideEffects } from '@ngrx/effects'
import { provideTranslateService } from '@ngx-translate/core'
import { provideTranslateHttpLoader } from '@ngx-translate/http-loader'
import { routes } from './app.routes'
import { AUTH_FEATURE } from './auth/store/auth.state'
import { authReducer } from './auth/store/auth.reducer'
import { authEffects } from './auth/store/auth.effects'
import { USER_FEATURE } from './user/store/user.state'
import { userReducer } from './user/store/user.reducer'
import { userEffects } from './user/store/user.effects'
import { RATES_FEATURE } from './core/store/rates.state'
import { ratesReducer } from './core/store/rates.reducer'
import { ratesEffects } from './core/store/rates.effects'
import { tmaAuthInterceptor } from './auth/interceptors/tma-auth.interceptor'
import { loadingInterceptor } from './shared/interceptors/loading.interceptor'
import { StaleBundleRecoveryService } from './shared/services/stale-bundle-recovery.service'
import { IdlePreloadStrategy } from './shared/services/idle-preload.strategy'
import { TmaService } from './auth/services/tma.service'

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),

    /**
     * The Telegram handshake, before the router navigates anywhere.
     *
     * It used to run in `AppComponent.ngOnInit`, which is *after* the initial
     * navigation — so `tmaGuard` asked whether the launch was signed while
     * `initData` was still the empty string it starts as, and bounced every
     * real user to the "open in Telegram" screen. The same ordering also meant
     * any request fired during bootstrap went out without the credential
     * header.
     *
     * Reading the SDK is synchronous and the script tag in `index.html` is not
     * deferred, so this costs nothing and cannot fail: `init()` returns quietly
     * when there is no `window.Telegram`, which is exactly the case the guard
     * then refuses.
     */
    provideAppInitializer(() => inject(TmaService).init()),
    /**
     * A release deletes the lazy bundles an already-open app is still holding,
     * so the next tap fails to import one and the router raises
     * `NavigationError`. Unhandled, that is a screen where navigation silently
     * stops working — which is what users hit after a deploy. The service
     * reloads onto the current deploy, once per session and only for that
     * specific failure.
     */
    provideRouter(
      routes,
      /**
       * Preload lazy chunks in the background so navigation between sections is
       * instant — but idle-paced and sequential, because everything crosses the
       * Tor onion and eager preloading would starve the first screen's own calls.
       * See IdlePreloadStrategy.
       */
      withPreloading(IdlePreloadStrategy),
      withNavigationErrorHandler((event: NavigationError) =>
        inject(StaleBundleRecoveryService).recover(event.error, event.url)
      )
    ),
    provideHttpClient(withInterceptors([tmaAuthInterceptor, loadingInterceptor])),

    /**
     * Three slices at the root, because all three are app-wide: the guard on
     * every route waits on `auth`, the nav and the dashboard both read `user`,
     * and `rates` polls whether or not anything is displaying it. The trust
     * ladder is registered by `dashboard/routes.ts` instead — only that module
     * reads it, so a session that never opens it costs no reducer.
     *
     * No `provideStoreDevtools()`, deliberately. This store holds a user's
     * balance and their top-up card numbers, and a devtools connection publishes
     * every action to any extension the client happens to have installed —
     * inside a WebView we do not control.
     */
    provideStore({
      [AUTH_FEATURE]: authReducer,
      [USER_FEATURE]: userReducer,
      [RATES_FEATURE]: ratesReducer
    }),
    provideEffects(authEffects, userEffects, ratesEffects),

    provideTranslateService(),
    provideTranslateHttpLoader({ prefix: './assets/i18n/', suffix: '.json' })
  ]
}
