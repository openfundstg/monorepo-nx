import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { toObservable } from '@angular/core/rxjs-interop';
import { filter, map, take } from 'rxjs/operators';

export const authGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return toObservable(authService.isInitializing).pipe(
    filter(isInit => !isInit),
    take(1),
    map(() => {
      if (authService.token()) {
        return true;
      }
      return router.createUrlTree(['/login']);
    })
  );
};

export const guestGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return toObservable(authService.isInitializing).pipe(
    filter(isInit => !isInit),
    take(1),
    map(() => {
      if (!authService.token()) {
        return true;
      }
      return router.createUrlTree(['/']);
    })
  );
};
