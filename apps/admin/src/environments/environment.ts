/**
 * Development. Everything is same-origin: `proxy.conf.json` forwards `/api` and
 * `/socket.io` to the backend on 8000.
 *
 * Same-origin is not a convenience here — the panel authenticates with a cookie,
 * and the API deliberately does not send `Access-Control-Allow-Credentials`, so
 * a cross-origin call would arrive unauthenticated. See the CORS note in the
 * backend's `main.ts`.
 */
export const environment = {
  production: false,
  apiUrl: '/api/admin',
  /** Empty means "this origin" — Socket.IO connects back to where the page came from. */
  wsUrl: '',
  /** The Socket.IO namespace the admin gateway serves. */
  wsNamespace: '/admin',
} as const;
