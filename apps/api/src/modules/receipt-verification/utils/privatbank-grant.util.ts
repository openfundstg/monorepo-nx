import type { PrivatbankDocumentGrant } from 'src/modules/receipt-verification/services/privatbank-document.api.service'
import type { PrivatbankFindDocumentResponse } from 'src/shared/interfaces'

/** What was missing, when a lookup did not yield a grant. */
export enum PrivatbankGrantGap {
  /** Their explicit negative: no document of that kind has that number. */
  DOCUMENT = 'DOCUMENT',
  /**
   * They know the document and issued nothing usable to fetch it with.
   *
   * **A token without its session is not a grant.** The download's `csrf` is
   * bound to the `PHPSESSID` the very same response set, so presenting one
   * without the other is a session that never existed — it answers `500` with
   * an HTML page. Their own success reply always carries both, so missing
   * either means their shape moved, which is a different problem from a code
   * nobody has heard of and a different thing to tell whoever is waiting.
   */
  GRANT = 'GRANT'
}

export interface PrivatbankGranted {
  readonly grant: PrivatbankDocumentGrant
}

export interface PrivatbankGrantMissing {
  readonly gap: PrivatbankGrantGap
}

/**
 * Named members rather than inline object types, so this narrows in **both**
 * directions — a caller writing `if (!isGranted(x)) … x.gap` needs the negative
 * branch to be a type, not a shape TypeScript re-derives.
 */
export type PrivatbankGrant = PrivatbankGranted | PrivatbankGrantMissing

/**
 * The grant inside a lookup's answer, or what was missing from it.
 *
 * **One statement of what a usable grant is**, for the two callers that ask
 * PrivatBank the same question about two document kinds — a receipt's code and
 * a statement's number. It was written twice and the copies had already
 * drifted: the receipt path refused a grant with no session and the statement
 * path did not, which turned a moved response shape into a generic download
 * failure much further downstream.
 *
 * Pure, and it decides nothing beyond their wire contract. Whether a missing
 * document is `UNKNOWN` or `NOT_REGISTERED`, and what to log about it, stays
 * with each caller — those are two different vocabularies for two different
 * things the product does.
 */
export const readGrant = (answer: {
  readonly body: PrivatbankFindDocumentResponse
  readonly cookie: string
  readonly session: string
}): PrivatbankGrant => {
  if (answer.body.status !== true) return { gap: PrivatbankGrantGap.DOCUMENT }

  const { token } = answer.body
  if (token === undefined || answer.cookie === '') return { gap: PrivatbankGrantGap.GRANT }

  return { grant: { token, cookie: answer.cookie, session: answer.session } }
}

/** Whether a lookup yielded something to download with. */
export const isGranted = (result: PrivatbankGrant): result is PrivatbankGranted =>
  'grant' in result
