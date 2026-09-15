/** Everything that could plausibly name the person receiving the money. */
export interface ReceiverNameSources {
  /**
   * The account holder as the bank itself reports them.
   *
   * PrivatBank names its envelope's owner, masked to a surname and an initial —
   * "Петренко І.". No other bank we support discloses one.
   */
  readonly bankOwnerName?: string | null
  /** The Telegram profile of whoever created the order. */
  readonly firstName?: string | null
  readonly lastName?: string | null
  readonly username?: string | null
  /** Last resort, so the field is never empty. */
  readonly telegramId: number
}

/** Collapses runs of whitespace and trims; empty becomes `null`. */
const clean = (value: string | null | undefined): string | null => {
  const trimmed = value?.replace(/\s+/g, ' ').trim()

  return trimmed ? trimmed : null
}

/**
 * The name a payer sees as the recipient of their transfer.
 *
 * Sent as `name` on `credentials_create`, and returned on every order as
 * `receiver_name`. It used to be `TMA-<telegramId>`, on the belief that the
 * field was somewhere to keep our own identifier — it is not. It is the human
 * on the other end of the transfer, and a payer shown an internal code has been
 * given a reason to abandon the payment rather than a reason to trust it.
 *
 * Four sources, best first, and the order is a claim about how much each is
 * worth:
 *
 * 1. **The bank's own answer.** Authoritative: PrivatBank is naming the account
 *    it will pay into, so it cannot disagree with itself.
 * 2. **The Telegram profile name.** A guess, and knowingly so — it names who
 *    *created* the order, and the jar may belong to somebody else. Better than
 *    nothing, which is what the other banks leave us with.
 * 3. **The Telegram username**, for a profile with no name set at all.
 * 4. **The old identifier**, so the field is never empty — the API requires it,
 *    and refusing to create a terminal over a cosmetic field would cost a user
 *    their order.
 *
 * The bank's figure is deliberately not reformatted to match the others, or
 * they would become indistinguishable: "Петренко І." is a bank's statement about
 * an account, and "Роман Петренко" is a Telegram display name, and only the first
 * has been checked by anyone.
 */
export const resolveReceiverName = (sources: ReceiverNameSources): string => {
  const fromBank = clean(sources.bankOwnerName)
  if (fromBank) return fromBank

  const fromProfile = clean(`${sources.firstName ?? ''} ${sources.lastName ?? ''}`)
  if (fromProfile) return fromProfile

  const fromUsername = clean(sources.username)
  if (fromUsername) return fromUsername

  return `TMA-${sources.telegramId}`
}
