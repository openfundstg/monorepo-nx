import { HttpContextToken } from '@angular/common/http';

/**
 * How long a request may run before the overlay appears.
 *
 * Most calls here finish well inside this, and an overlay that flashes up for
 * a request that was never slow reads as jank rather than as feedback. Only
 * something the user would otherwise think had hung gets one.
 */
export const SPINNER_DELAY_MS = 300;

/**
 * Set on a request that should never raise the overlay.
 *
 * For work the user did not ask for and is not waiting on — a refetch triggered
 * by a socket push, say. Blurring the screen for those would interrupt someone
 * mid-read for something they never started.
 *
 * ```ts
 * this.http.get(url, { context: new HttpContext().set(SKIP_LOADING, true) })
 * ```
 */
export const SKIP_LOADING = new HttpContextToken<boolean>(() => false);
