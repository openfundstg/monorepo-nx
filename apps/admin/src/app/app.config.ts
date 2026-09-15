import { ApplicationConfig, isDevMode, provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideStore } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import { provideStoreDevtools } from '@ngrx/store-devtools';
import { provideTranslateService } from '@ngx-translate/core';
import { provideTranslateHttpLoader } from '@ngx-translate/http-loader';
import { MatPaginatorIntl } from '@angular/material/paginator';
import { routes } from './app.routes';
import { authEffects } from './auth/store/auth.effects';
import { authReducer } from './auth/store/auth.reducer';
import { AUTH_FEATURE } from './auth/store/auth.state';
import { csrfInterceptor } from './core/interceptors/csrf.interceptor';
import { sessionInterceptor } from './core/interceptors/session.interceptor';
import { TranslatedPaginatorIntl } from './core/i18n/translated-paginator.intl';

export const appConfig: ApplicationConfig = {
  providers: [
    /**
     * No `provideAnimationsAsync()`.
     *
     * Angular Material 22 no longer needs the animations package — its
     * components animate with CSS — and providing it would pull
     * `@angular/animations` into the bundle for nothing.
     */
    provideZonelessChangeDetection(),
    provideRouter(routes, withComponentInputBinding()),

    /**
     * Order matters. `sessionInterceptor` is outermost so it sees the response
     * of every request including the CSRF-stamped ones, and `csrfInterceptor`
     * sits inside it where it can still clone the outgoing request.
     */
    provideHttpClient(withInterceptors([sessionInterceptor, csrfInterceptor])),

    /**
     * Only `auth` is registered at the root. Every list registers its own slice
     * through `provideState` in its `routes.ts`, so a screen nobody opens costs
     * no reducer and no effect subscription.
     */
    provideStore({ [AUTH_FEATURE]: authReducer }),
    provideEffects(authEffects),

    provideStoreDevtools({
      maxAge: 50,
      // The store holds every user's balance and every jar link on screen.
      // Shipping a devtools connection into production would publish that to
      // any extension the operator happens to have installed.
      logOnly: !isDevMode(),
      connectInZone: false,
    }),

    provideTranslateService({ fallbackLang: 'uk', lang: 'uk' }),
    provideTranslateHttpLoader({ prefix: './assets/i18n/', suffix: '.json' }),

    /**
     * Material ships English paginator labels and offers no hook into
     * `ngx-translate`. Global rather than per-screen because the paginator
     * lives inside the shared table component that all eleven lists render.
     */
    { provide: MatPaginatorIntl, useClass: TranslatedPaginatorIntl },
  ],
};
