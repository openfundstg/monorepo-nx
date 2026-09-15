import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { provideTranslateService } from '@ngx-translate/core';
import { provideTranslateHttpLoader } from '@ngx-translate/http-loader';
import { provideRouter, withComponentInputBinding, withHashLocation } from '@angular/router';
import { routes } from './app.routes';
import { apiTokenInterceptor } from './core/interceptors/api-token.interceptor';
import { SocketSyncService } from './core/services/socket-sync.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes, withHashLocation(), withComponentInputBinding()),
    provideZonelessChangeDetection(),
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(withFetch(), withInterceptors([apiTokenInterceptor])),
    provideTranslateService(),
    provideTranslateHttpLoader({ prefix: './assets/i18n/', suffix: '.json' }),
    // Nothing injects SocketSyncService, so it has to be created eagerly —
    // it only listens.
    provideAppInitializer(() => {
      inject(SocketSyncService);
    }),
  ],
};
