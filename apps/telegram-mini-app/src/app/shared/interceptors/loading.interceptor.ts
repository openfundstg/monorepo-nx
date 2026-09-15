import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { finalize } from 'rxjs';
import { LoadingService } from '../services/loading.service';
import { SKIP_LOADING } from '../constants/loading.const';
import { environment } from '../../../environments/environment';

/**
 * Raises the loading overlay while the app is talking to its API.
 *
 * Scoped to `environment.apiUrl` rather than to every request: `ngx-translate`
 * fetches the dictionaries over the same `HttpClient` at boot, and blurring a
 * screen that has not rendered yet would be a strange first impression. Any
 * future asset fetch is excluded by the same rule, without needing to know
 * about it.
 */
export const loadingInterceptor: HttpInterceptorFn = (req, next) => {
  const counted = req.url.startsWith(environment.apiUrl) && !req.context.get(SKIP_LOADING);
  if (!counted) return next(req);

  const loading = inject(LoadingService);
  loading.start();

  // `finalize`, not a `tap` on success: a request that errors or is cancelled
  // must release the overlay too, or one failure leaves the app blurred.
  return next(req).pipe(finalize(() => loading.stop()));
};
