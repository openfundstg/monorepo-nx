import { SetMetadata } from '@nestjs/common'

/** Reflector key written by {@link DemoAllowed}. */
export const DEMO_ALLOWED_METADATA = 'tma:demo-allowed'

/**
 * Lets a demo account reach a handler that is a write by method only.
 *
 * `DemoReadOnlyGuard` refuses every other `POST`, `PUT`, `PATCH` and `DELETE`
 * such an account sends, and that default is the point: a write added
 * tomorrow is refused without anybody remembering to. So this goes only on a
 * handler that changes nothing a demo account's screen could be lying about —
 * the launch itself, and reading a jar the promoter pasted.
 */
export const DemoAllowed = () => SetMetadata(DEMO_ALLOWED_METADATA, true)
