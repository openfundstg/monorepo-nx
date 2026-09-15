import { SetMetadata } from '@nestjs/common'
import { UserType } from 'src/shared/constants'
import { AUTH_METADATA } from 'src/modules/auth/constants/auth-metadata.constants'

/**
 * Restricts a handler (or a whole controller) to the listed user types.
 *
 * `UserTypesGuard` authenticates against each type in order and lets the
 * request through on the first one that succeeds, so listing several types
 * means "any of these may call me", not "all of these".
 *
 *     @UserTypes(UserType.TRADER, UserType.TMA)
 */
export const UserTypes = (...types: UserType[]) => SetMetadata(AUTH_METADATA.USER_TYPES, types)

/** Authenticated trader only — requires a valid `x-api-token`. */
export const UserTypeTrader = () => UserTypes(UserType.TRADER)

/** Authenticated Telegram Mini App user only — requires valid `x-tma-init-data`. */
export const UserTypeTMA = () => UserTypes(UserType.TMA)

/**
 * Authenticated admin only — requires a live `admin_session` cookie.
 *
 * Unlike the two above, this credential is ambient, so every handler carrying
 * it is also subject to `CsrfGuard`. A state-changing admin request must send
 * the `x-csrf-token` header echoing the `csrf-token` cookie, or it is refused.
 */
export const UserTypeAdmin = () => UserTypes(UserType.ADMIN)
