/**
 * Which of the two questions a statement is being uploaded to answer.
 *
 * A card sale accepts a bank statement in exactly two situations, and they are
 * not the same order in the same state:
 *
 * - **A denial.** "This payment never arrived." The order is `DISPUTED`, the
 *   terminal is stopped, and the document decides whether the denial stands.
 * - **A shortfall.** "₴995 arrived of ₴1 000." The order is `CONFIRMED` and
 *   carries the figure its seller declared — the one claim on a card sale they
 *   gain by making — and the remainder is being held until a document checks it.
 *
 * Named rather than re-derived at each layer. The service decides which it is
 * before a byte of the upload is read; the write that records it re-applies
 * *that* decision rather than restating the rule, which is how the two came
 * apart the first time — the write insisted on `DISPUTED`, so every checkpoint
 * statement was stored on disk and then refused with a 409.
 *
 * In `shared/` because both ends need it and neither may import the other: the
 * decision is a domain service's, the filter that re-applies it is a repository's,
 * and a repository never depends on a domain module.
 */
export enum StatementSubject {
  DENIAL = 'DENIAL',
  SHORTFALL = 'SHORTFALL'
}
