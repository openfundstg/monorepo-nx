/**
 * Who is allowed to call an endpoint.
 *
 * Each type maps to exactly one authentication scheme, resolved by
 * `UserTypesGuard`:
 *
 * | Type     | Credential header   | Attached to request |
 * |----------|---------------------|---------------------|
 * | `TRADER` | `x-api-token`       | `request.trader`    |
 * | `TMA`    | `x-tma-init-data`   | `request.tmaUser`   |
 * | `ADMIN`  | `admin_session` cookie | `request.admin`  |
 *
 * `ADMIN` is the first scheme here whose credential is *ambient* — a cookie the
 * browser attaches by itself. That is what finally makes `CsrfGuard` do
 * something: the header-bearing schemes above cannot be forged cross-site, and
 * this one can, so the login response sets the `csrf-token` cookie that
 * switches the guard on for exactly these routes.
 */
export enum UserType {
  TRADER = 'TRADER',
  TMA = 'TMA',
  ADMIN = 'ADMIN'
}
