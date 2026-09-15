/** Reflector keys written by the access-control decorators. */
export const AUTH_METADATA = {
  /** `UserType[]` — which authenticated callers may reach the handler. */
  USER_TYPES: 'auth:user-types',
  /** `true` — handler needs no authentication at all. */
  PUBLIC: 'auth:public',
  /** `true` — handler is exempt from the CSRF double-submit check. */
  SKIP_CSRF: 'auth:skip-csrf'
} as const
