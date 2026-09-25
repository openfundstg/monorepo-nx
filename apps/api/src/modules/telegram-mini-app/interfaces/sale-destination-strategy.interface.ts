import type { BankProvider, SaleMethod } from '@transacto/contracts'

/** Who is selling, as a destination needs to know them. */
export interface SaleSeller {
  readonly telegramId: number
  readonly firstName?: string | null
  readonly lastName?: string | null
  readonly username?: string | null
}

/** What a caller knows before a destination has been resolved. */
export interface SaleDestinationRequest {
  readonly seller: SaleSeller
  readonly bankType: BankProvider
  /** The jar link, as the user pasted it. Empty on a card sale. */
  readonly dropLink: string
  /** Sixteen digits, however the user typed them. */
  readonly cardNumber: string
  /** Who the payer should see, when the user is the one who says. */
  readonly receiverName?: string
}

/**
 * Where one sale's hryvnia is going, settled before anything is frozen.
 *
 * Every field here is a decision that used to be made inline in
 * `SaleFacadeService.createSale` and is only meaningful for one variant or the
 * other. Resolving them behind a strategy is what stops the facade growing a
 * second copy of itself under an `if`.
 */
export interface SaleDestination {
  /**
   * The name a payer is shown as the person they are paying.
   *
   * Not a slot for our own identifiers — it used to read `TMA-885140`, which
   * gave payers a reason to abandon the transfer rather than trust it.
   *
   * **Never persisted**, like {@link payoutCardNumber}. It goes upstream as the
   * terminal's `name`, which is where a payer and an operator both read it.
   */
  readonly receiverName: string
  /**
   * The card the money lands on — Transacto's `cred`.
   *
   * **Never persisted.** It goes upstream and is forgotten; what a sale keeps
   * is its last four digits. See `cardTail`.
   */
  readonly payoutCardNumber: string
  /** The jar link Transacto routes payers to, or `null` when there is no jar. */
  readonly dropLink: string | null
  /**
   * Whether the **bank** named the card, rather than the user typing it.
   *
   * Decides whether the dead-order fraud rule applies: that rule catches a card
   * that does not belong to the jar, which cannot happen when the jar named the
   * card. Always `false` on a card sale, where there is no jar to disagree with
   * and nothing but the seller's own statement will ever check the account.
   */
  readonly cardVerifiedByBank: boolean
  /**
   * The jar's own target as the bank reports it, in UAH kopecks.
   *
   * `null` means "not known", which is every card sale and every bank that
   * publishes no goal. A caller must read it as unknown and never as a mismatch.
   */
  readonly observedGoal: number | null
}

/**
 * The routing knobs a variant sets on its Transacto credential.
 *
 * Stated in this codebase's own vocabulary and mapped onto
 * `TransactoCredentialsCreateRequest` by the one caller that speaks to
 * Transacto. Their field names are not ours to spread through the domain, and
 * the mapping belongs where the request is built.
 *
 * Whole hryvnia throughout, because that is the only precision the upstream
 * fields express — the same reason a jar's goal is snapped before it is sent.
 */
export interface SaleCredentialLimits {
  /** How many payers may hold an order against this terminal at once. */
  readonly maxOpenOrders: number
  /** The smallest order Transacto may route here, or `undefined` for no floor of ours. */
  readonly minAmountUah?: number
  /** The largest, or `undefined`. */
  readonly maxAmountUah?: number
  /** A lifetime cap on how many transactions may pass through, or `undefined`. */
  readonly maxTxCountTotal?: number
}

/**
 * One variant's answer to "where does this sale's money go, and on what terms".
 *
 * Two implementations, and they differ in the one thing that matters: what
 * proves the hryvnia arrived. A jar sale is proven by the bank, through a link
 * that resolves to a goal and sometimes to a card. A card sale is proven by the
 * seller pressing a button, which is why its credential is capped where the
 * other's is not — those caps are the only guard it has.
 *
 * Injected as an array under `SALE_DESTINATION_STRATEGIES`, in the manner of
 * `RECEIPT_CODE_STRATEGIES`, so adding a third variant is a provider rather
 * than another branch in the facade.
 */
export interface SaleDestinationStrategy {
  readonly method: SaleMethod

  /**
   * Refuses what this variant cannot do, and says where the money goes.
   *
   * Runs **before** the stake is frozen and before anything reaches Transacto,
   * so every refusal here costs the user a form error rather than a frozen
   * balance. Throws an `ERROR.SALE`/`ERROR.SALE_CARD` exception.
   */
  resolve(request: SaleDestinationRequest): Promise<SaleDestination>

  /** The credential limits a terminal for this variant is created with. */
  credentialLimits(targetKopecks: number): SaleCredentialLimits
}
