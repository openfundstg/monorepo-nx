import { SetMetadata } from '@nestjs/common'
import { AUTH_METADATA } from 'src/modules/auth/constants/auth-metadata.constants'

/**
 * Opens a handler to unauthenticated callers.
 *
 * Required, not optional: `UserTypesGuard` denies by default, so an endpoint
 * with no access decorator at all returns 401. Reaching for `@Public()` should
 * feel like a decision, because it is one.
 */
export const Public = () => SetMetadata(AUTH_METADATA.PUBLIC, true)
