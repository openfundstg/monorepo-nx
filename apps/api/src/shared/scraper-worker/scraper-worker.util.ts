import type { ScraperWorkerResult } from 'src/shared/interfaces'

/**
 * The worker's response body, parsed as JSON.
 *
 * The body comes back as bytes — the worker relays PDFs and HTML too — so every
 * caller that wanted an object was decoding and parsing it the same way. This is
 * the one place that turns those bytes into a typed object; the caller supplies
 * the type and owns whether a parse failure is a bank outage or a bug.
 */
export const parseJsonBody = <T>(result: ScraperWorkerResult): T =>
  JSON.parse(result.body.toString('utf8')) as T
