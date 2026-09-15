import { SetMetadata } from '@nestjs/common'
import { AUTH_METADATA } from 'src/modules/auth/constants/auth-metadata.constants'

/**
 * Exempts a handler from the CSRF double-submit check.
 *
 * For third-party callers that authenticate with their own scheme and can't
 * hold a CSRF token — inbound webhooks, OAuth callbacks. See `CsrfGuard` for
 * why this is currently a no-op for every route.
 */
export const SkipCsrf = () => SetMetadata(AUTH_METADATA.SKIP_CSRF, true)
