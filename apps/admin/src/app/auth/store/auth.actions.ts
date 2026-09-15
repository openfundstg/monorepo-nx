import { createActionGroup, emptyProps, props } from '@ngrx/store';
import type { AdminLoginReq, AdminSessionRes, ApiError } from '@transacto/contracts';

export const authActions = createActionGroup({
  source: 'Auth',
  events: {
    /**
     * Asks the server who the cookie belongs to, on every app start.
     *
     * The session lives in an `HttpOnly` cookie the page cannot read, so
     * "am I logged in?" is a request rather than a property. It is also where
     * the CSRF token comes back from after a reload.
     */
    Restore: emptyProps(),
    'Restore Success': props<{ session: AdminSessionRes }>(),
    /** No session. Not an error worth showing — it is the ordinary first visit. */
    'Restore Failure': emptyProps(),

    Login: props<{ credentials: AdminLoginReq }>(),
    'Login Success': props<{ session: AdminSessionRes }>(),
    'Login Failure': props<{ error: ApiError }>(),

    Logout: emptyProps(),
    'Logout Success': emptyProps(),

    /**
     * A request came back unauthenticated.
     *
     * Distinct from {@link Logout}: nobody asked, so there is no server call to
     * make and the operator should be told why they are back at the form.
     */
    'Session Expired': emptyProps(),
  },
});
