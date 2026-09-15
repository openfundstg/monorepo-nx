/**
 * Production. The panel is served from `/admin` on the same host as the API, so
 * both paths stay relative — see the note in `environment.ts` for why
 * same-origin is load-bearing rather than incidental.
 */
export const environment = {
  production: true,
  apiUrl: '/api/admin',
  wsUrl: '',
  wsNamespace: '/admin',
} as const;
