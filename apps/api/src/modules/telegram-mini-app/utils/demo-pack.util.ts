import {
  BalanceEntryKind,
  CARD_NUMBER_LENGTH,
  CARD_SALE_ENABLED_BANKS,
  CARD_TAIL_LENGTH,
  CENTS_PER_USDT,
  KOPECKS_PER_UAH,
  MIN_USDT_CENTS,
  OBJECT_ID_ALPHABET,
  OBJECT_ID_LENGTH,
  PUBLIC_ID_ALPHABET,
  PUBLIC_ID_LENGTH,
  REFERRAL_MASKED_ID_LENGTH,
  SALE_ENABLED_BANKS,
  SaleCardOrderState,
  SaleEventType,
  SaleMethod,
  TmaDepositStatus,
  TmaFiatDepositStatus,
  TmaFiatReceiptStatus,
  TmaSaleStatus,
  defaultRemainderPolicy,
  depositFiatEquivalent,
  isLuhnValid,
  priceStake,
  roundToWholeUah,
  saleCardMaxOrders,
  saleCardMinOrderKopecks,
  topUpCreditCents,
  type BalanceHistoryEntry,
  type FiatDepositOptionsResponse,
  type ReferralEntry,
  type SaleCardOrder,
  type SaleEvent,
  type TmaDemoPack,
  type TmaDemoSale,
  type TmaDeposit,
  type TmaFiatDeposit,
  type TmaUser
} from '@transacto/contracts'
import {
  DAY_MS,
  HOUR_MS,
  MINUTE_MS,
  SECOND_MS,
  TMA_CARD_SALE_CONFIRM_WINDOW_MINUTES,
  getTrustLevel,
  trustLadder
} from 'src/shared/constants'
import {
  DEMO_CARD_NETWORK_PREFIXES,
  DEMO_REFERRAL_FIRST_NAMES,
  DEMO_REFERRAL_INITIALS,
  DEMO_REFERRAL_TRANSFER_ROUNDS,
  DEMO_SEED_SALT,
  DemoCycleGapsHours,
  DemoFiatOfferShape,
  DemoHistoryShape,
  DemoReferralShape,
  DemoTimingMinutes,
  DemoTimingSeconds,
  DemoUpstreamIds
} from 'src/modules/telegram-mini-app/constants'
import { DemoStepKind } from 'src/modules/telegram-mini-app/enums'
import type { ReferralSharingTerms } from 'src/modules/telegram-mini-app/interfaces/referral-sharing-terms.interface'
import { matchSalesToLots, type UsdtLot, type UsdtSale } from './income-fifo.util'
import { referralRewardCents } from './referral-reward.util'
import { seededRandom, seedFrom, type SeededRandom } from './seeded-random.util'

/** Everything the story needs that it must not invent. */
export interface DemoPackInput {
  /** Seeds every choice, so one account is shown one story on every open. */
  readonly telegramId: number
  /** The account's own name — the one part of the profile that is not drawn. */
  readonly identity: Pick<TmaUser, 'firstName' | 'lastName' | 'username' | 'showNameToReferrer'>
  /** Epoch milliseconds the history is drawn back from. */
  readonly now: number
  /** Kopecks per USDT for acquiring USDT, live. */
  readonly buyRate: number
  /** Kopecks per USDT for selling it, live. */
  readonly sellRate: number
  /** The account's real code and link, and the rate in force. */
  readonly referral: ReferralSharingTerms
  /** The real wallet a USDT deposit is sent to. */
  readonly walletAddress: string
  /** Minutes a USDT deposit waits for its transfer. */
  readonly depositExpiryMinutes: number
  readonly payWindowMinutes: number
  /** Transacto's order floor, in UAH kopecks. */
  readonly minOrderKopecks: number
}

/**
 * The generated history a demo account shows in place of its own.
 *
 * **Deterministic.** The account id seeds every choice, and every date is an
 * offset from `now`, so the same promoter sees the same story on every take —
 * the latest top-up a few hours old whatever day they record on — without a
 * byte of it being stored.
 *
 * **Consistent by construction.** The balance is not chosen; it is what the
 * history leaves behind. A sale stakes a share of the balance it is made from,
 * is priced by `priceStake` at the rate of its day, and fills in payments no
 * smaller than the pipeline routes. Referral earnings are the product's own
 * reward on the volumes listed beside them, and the referral transfers on the
 * timeline are what separates the lifetime figure from the pot — each moving
 * no more than the people who had joined by then could have earned. Income is
 * the same FIFO the real page runs. A viewer who adds the screen up gets the
 * screen.
 */
export const buildDemoPack = (input: DemoPackInput): TmaDemoPack => {
  const random = seededRandom(seedFrom(input.telegramId) ^ DEMO_SEED_SALT)
  const drift = random.between(0, 2 * Math.PI)
  const referrals = drawReferrals(random, input)
  const totalEarned = referrals.reduce((sum, entry) => sum + entry.earned, 0)
  const steps = priceTransfers(planSteps(random, input.now), referrals, input.now)

  const ledger = steps.reduce(
    (current, step) => applyStep(current, step, random, input, drift),
    EMPTY_LEDGER
  )

  // Only a transfer carries cents, so this is what the transfers moved.
  const referralBalance = totalEarned - steps.reduce((sum, step) => sum + step.cents, 0)
  const trust = getTrustLevel(ledger.turnoverKopecks)
  const buyRate = input.buyRate

  return {
    profile: {
      user: {
        telegramId: input.telegramId,
        ...input.identity,
        balance: ledger.balanceCents,
        frozenBalance: 0,
        totalTurnover: ledger.turnoverKopecks,
        isActive: true,
        referralBalance,
        totalReferralEarned: totalEarned
      },
      trustLevel: trust.level,
      maxParallelOrders: trust.maxParallelOrders,
      slotsAwaitingJarClosure: []
    },
    history: ledger.history.toSorted((left, right) =>
      right.createdAt.localeCompare(left.createdAt)
    ),
    referral: {
      ...input.referral,
      balance: referralBalance,
      totalEarned,
      totalVolume: referrals.reduce((sum, entry) => sum + entry.soldVolume, 0),
      // Nobody invited the promoter, and an account that has sold cannot redeem
      // a code — the same rule `getSummary` applies to a real one.
      invitedBy: null,
      canRedeemCode: false,
      referrals
    },
    income: matchSalesToLots(ledger.lots, ledger.sold),
    trustLadder: trustLadder(),
    saleConfig: {
      trustLevel: trust.level,
      maxParallelOrders: trust.maxParallelOrders,
      openOrders: 0,
      slotsAwaitingJarClosure: [],
      sellRate: input.sellRate,
      balance: ledger.balanceCents,
      minOrderKopecks: input.minOrderKopecks
    },
    depositConfig: {
      walletAddress: input.walletAddress,
      exchangeRate: buyRate,
      expiryMinutes: input.depositExpiryMinutes
    },
    fiatOptions: drawFiatOffer(random, buyRate, input.payWindowMinutes),
    sales: ledger.sales,
    deposits: ledger.deposits,
    fiatDeposits: ledger.fiatDeposits,
    recipientCard: unpayableCard(random)
  }
}

// --- Small shapes -------------------------------------------------------------

const HEX_UPPER = '0123456789ABCDEF'
const DIGITS = '0123456789'
/** Payouts and offers come in whole tens of hryvnias. */
const PAYOUT_STEP_UAH = 10

const objectId = (random: SeededRandom): string =>
  random.chars(OBJECT_ID_ALPHABET, OBJECT_ID_LENGTH)

const iso = (epochMs: number): string => new Date(epochMs).toISOString()

/**
 * A rate on a day `daysAgo` in the past, wandering around today's.
 *
 * Buy and sell are moved by the same factor, so the spread between them — the
 * thing the dashboard advertises — holds on every day of the history. Zero
 * days ago it is today's rate exactly.
 */
const rateOn = (rate: number, daysAgo: number, phase: number): number =>
  Math.round(
    rate *
      (1 +
        DemoHistoryShape.RATE_DRIFT *
          (Math.sin(daysAgo / DemoHistoryShape.RATE_DRIFT_PERIOD_DAYS + phase) - Math.sin(phase)))
  )

/**
 * Moves a moment onto the waking hours of its own day.
 *
 * The whole day is squeezed into the window rather than night being clipped,
 * so a later moment stays later and the order of a history survives the move.
 * It never moves anything past the end of its own day, which is why it is safe
 * on everything but the last few hours before `now`.
 */
const duringDaytime = (at: number): number => {
  const dayStart = at - (at % DAY_MS)
  const intoDay = (at - dayStart) / DAY_MS

  return (
    dayStart +
    (DemoHistoryShape.DAYTIME_START_HOUR_UTC + intoDay * DemoHistoryShape.DAYTIME_HOURS) * HOUR_MS
  )
}

/**
 * The latest waking moment at or before `at`: `at` itself during the day, the
 * end of the previous evening at night.
 *
 * For the one step that has to stay close to `now` — the newest row, the one a
 * dashboard shows first — where squeezing the day the way {@link duringDaytime}
 * does could carry it past `now`. Recorded at seven in the morning, the newest
 * top-up is last night's rather than one made at four.
 */
const latestDaytimeAtOrBefore = (at: number): number => {
  const opens = at - (at % DAY_MS) + DemoHistoryShape.DAYTIME_START_HOUR_UTC * HOUR_MS
  // A minute short of closing, so the moment is inside the window, not on its edge.
  const lastMinute = opens + DemoHistoryShape.DAYTIME_HOURS * HOUR_MS - MINUTE_MS

  if (at > lastMinute) return lastMinute
  if (at >= opens) return at

  return lastMinute - DAY_MS
}

// --- Referrals --------------------------------------------------------------

/**
 * The people below the promoter, highest earner first — the order the real
 * summary sorts in, ties broken on join date.
 */
const drawReferrals = (random: SeededRandom, input: DemoPackInput): readonly ReferralEntry[] =>
  Array.from(
    { length: random.int(DemoReferralShape.COUNT_MIN, DemoReferralShape.COUNT_MAX) },
    (_, index) => {
      const soldVolume = drawVolume(random, index)

      return {
        maskedId: random.chars(HEX_UPPER, REFERRAL_MASKED_ID_LENGTH),
        displayName: random.chance(DemoReferralShape.NAMED_CHANCE) ? drawName(random) : null,
        earned: referralRewardCents(soldVolume, input.sellRate, input.referral.ratePercent),
        soldVolume,
        joinedAt: iso(duringDaytime(input.now - drawDaysSinceJoining(random, index) * DAY_MS))
      }
    }
  ).toSorted(
    (left, right) => right.earned - left.earned || left.joinedAt.localeCompare(right.joinedAt)
  )

/**
 * How long ago one referral joined, by where they fall in the list.
 *
 * The heaviest sellers joined early — they have had the longest to sell that
 * much, and the transfers on the timeline are what they earned before each.
 */
const drawDaysSinceJoining = (random: SeededRandom, index: number): number =>
  random.between(
    index < DemoReferralShape.WHALES
      ? DemoReferralShape.WHALE_JOINED_MIN_DAYS_AGO
      : DemoReferralShape.JOINED_MIN_DAYS_AGO,
    DemoHistoryShape.HISTORY_DAYS
  )

/** UAH kopecks one referral has sold, by where they fall in the list. */
const drawVolume = (random: SeededRandom, index: number): number => {
  if (index < DemoReferralShape.WHALES)
    return wholeUah(random, DemoReferralShape.WHALE_MIN_UAH, DemoReferralShape.WHALE_MAX_UAH)

  if (index < DemoReferralShape.WHALES + DemoReferralShape.ACTIVE)
    return wholeUah(random, DemoReferralShape.ACTIVE_MIN_UAH, DemoReferralShape.ACTIVE_MAX_UAH)

  return random.chance(DemoReferralShape.SMALL_SELLER_CHANCE)
    ? wholeUah(random, DemoReferralShape.SMALL_MIN_UAH, DemoReferralShape.SMALL_MAX_UAH)
    : 0
}

const drawName = (random: SeededRandom): string => {
  const firstName = random.pick(DEMO_REFERRAL_FIRST_NAMES)

  return random.chance(DemoReferralShape.INITIAL_CHANCE)
    ? `${firstName} ${random.pick(DEMO_REFERRAL_INITIALS)}`
    : firstName
}

/** A whole number of hryvnias in `[min, max]`, as kopecks. */
const wholeUah = (random: SeededRandom, min: number, max: number): number =>
  random.int(min, max) * KOPECKS_PER_UAH

/** The same, in steps of {@link PAYOUT_STEP_UAH} — the way payouts and offers come. */
const payoutUah = (random: SeededRandom, min: number, max: number): number =>
  random.int(min / PAYOUT_STEP_UAH, max / PAYOUT_STEP_UAH) * PAYOUT_STEP_UAH * KOPECKS_PER_UAH

// --- The timeline -----------------------------------------------------------

interface DemoStep {
  readonly kind: DemoStepKind
  readonly at: number
  /** USDT cents moved across; only on a referral transfer. */
  readonly cents: number
}

/**
 * When everything happens, before anything is priced.
 *
 * The period is cut into equal rounds; each round tops up, maybe tops up
 * again, sells, maybe sells again, and — in the rounds that carry one — moves
 * the referral pot across. The last top-up lands a few hours before `now`, so
 * the history always ends today.
 */
const planSteps = (random: SeededRandom, now: number): readonly DemoStep[] => {
  const start = now - DemoHistoryShape.HISTORY_DAYS * DAY_MS
  const roundMs = (DemoHistoryShape.HISTORY_DAYS * DAY_MS) / DemoHistoryShape.CYCLES

  const rounds = Array.from({ length: DemoHistoryShape.CYCLES }, (_, cycle) =>
    planRound(random, start + cycle * roundMs, DEMO_REFERRAL_TRANSFER_ROUNDS.includes(cycle)).map(
      (step) => ({ ...step, at: duringDaytime(step.at) })
    )
  )
  const lastTopUp: DemoStep = {
    kind: DemoStepKind.TOP_UP,
    at: latestDaytimeAtOrBefore(
      now -
        random.between(
          DemoHistoryShape.LAST_TOP_UP_MIN_HOURS,
          DemoHistoryShape.LAST_TOP_UP_MAX_HOURS
        ) *
          HOUR_MS
    ),
    cents: 0
  }

  return [...rounds.flat(), lastTopUp]
}

const planRound = (
  random: SeededRandom,
  from: number,
  movesReferralPot: boolean
): readonly DemoStep[] => {
  const hours = (min: number, max: number): number => random.between(min, max) * HOUR_MS
  const gaps: readonly (readonly [DemoStepKind, number])[] = [
    [DemoStepKind.TOP_UP, hours(0, DemoCycleGapsHours.FIRST_TOP_UP_MAX)],
    ...(random.chance(DemoHistoryShape.SECOND_TOP_UP_CHANCE)
      ? [
          [
            DemoStepKind.TOP_UP,
            hours(DemoCycleGapsHours.SECOND_TOP_UP_MIN, DemoCycleGapsHours.SECOND_TOP_UP_MAX)
          ] as const
        ]
      : []),
    [
      DemoStepKind.SALE,
      hours(DemoCycleGapsHours.FIRST_SALE_MIN, DemoCycleGapsHours.FIRST_SALE_MAX)
    ],
    ...(random.chance(DemoHistoryShape.SECOND_SALE_CHANCE)
      ? [
          [
            DemoStepKind.SALE,
            hours(DemoCycleGapsHours.SECOND_SALE_MIN, DemoCycleGapsHours.SECOND_SALE_MAX)
          ] as const
        ]
      : []),
    ...(movesReferralPot
      ? [
          [
            DemoStepKind.REFERRAL_TRANSFER,
            hours(DemoCycleGapsHours.TRANSFER_MIN, DemoCycleGapsHours.TRANSFER_MAX)
          ] as const
        ]
      : [])
  ]

  return gaps.reduce<readonly DemoStep[]>(
    (steps, [kind, gap]) => [
      ...steps,
      // A transfer's cents are decided once its date is: see `priceTransfers`.
      { kind, at: (steps.at(-1)?.at ?? from) + gap, cents: 0 }
    ],
    []
  )
}

/**
 * How much each referral transfer moves, now that its date is known.
 *
 * Most of what is in the pot at that moment — `TRANSFER_SHARE` of it — and the
 * pot is what the people who had joined by then had earned, less what earlier
 * transfers already took. A transfer that would move nothing is dropped rather
 * than drawn as a row of zeros.
 */
const priceTransfers = (
  steps: readonly DemoStep[],
  referrals: readonly ReferralEntry[],
  now: number
): readonly DemoStep[] =>
  steps.reduce<{ readonly steps: readonly DemoStep[]; readonly moved: number }>(
    (priced, step) => {
      if (step.kind !== DemoStepKind.REFERRAL_TRANSFER)
        return { ...priced, steps: [...priced.steps, step] }

      const cents = Math.floor(
        (earnedBy(referrals, step.at, now) - priced.moved) * DemoReferralShape.TRANSFER_SHARE
      )

      return cents > 0
        ? { steps: [...priced.steps, { ...step, cents }], moved: priced.moved + cents }
        : priced
    },
    { steps: [], moved: 0 }
  ).steps

/**
 * What the referrals had earned the promoter by `at`, as far as the screen lets
 * anybody check it.
 *
 * The list shows each referral's join date and lifetime figure and nothing in
 * between, so each is taken to have earned it evenly from the day they joined:
 * nobody earns before joining, and nobody has earned it all before today.
 */
const earnedBy = (referrals: readonly ReferralEntry[], at: number, now: number): number =>
  referrals.reduce((sum, referral) => {
    const joined = Date.parse(referral.joinedAt)
    if (joined >= at) return sum

    return sum + Math.floor((referral.earned * (at - joined)) / (now - joined))
  }, 0)

// --- The ledger -------------------------------------------------------------

/** What the history has added up to so far. */
interface DemoLedger {
  /** USDT cents, spendable. */
  readonly balanceCents: number
  /** UAH kopecks, every sale's target. */
  readonly turnoverKopecks: number
  readonly history: readonly BalanceHistoryEntry[]
  readonly sales: readonly TmaDemoSale[]
  readonly deposits: readonly TmaDeposit[]
  readonly fiatDeposits: readonly TmaFiatDeposit[]
  /** Every arrival of USDT, for the income page's FIFO. */
  readonly lots: readonly UsdtLot[]
  /** Every sale, for the same. */
  readonly sold: readonly UsdtSale[]
}

const EMPTY_LEDGER: DemoLedger = {
  balanceCents: 0,
  turnoverKopecks: 0,
  history: [],
  sales: [],
  deposits: [],
  fiatDeposits: [],
  lots: [],
  sold: []
}

const applyStep = (
  ledger: DemoLedger,
  step: DemoStep,
  random: SeededRandom,
  input: DemoPackInput,
  drift: number
): DemoLedger => {
  const daysAgo = (input.now - step.at) / DAY_MS

  switch (step.kind) {
    case DemoStepKind.TOP_UP:
      return random.chance(DemoHistoryShape.FIAT_TOP_UP_SHARE)
        ? fiatTopUp(ledger, step.at, random, rateOn(input.buyRate, daysAgo, drift), input)
        : cryptoTopUp(ledger, step.at, random, rateOn(input.buyRate, daysAgo, drift), input)
    case DemoStepKind.SALE:
      return sale(ledger, step.at, random, rateOn(input.sellRate, daysAgo, drift), input)
    case DemoStepKind.REFERRAL_TRANSFER:
      return referralTransfer(ledger, step, random)
  }
}

/** A hryvnia payout paid, its receipt accepted, its USDT credited. */
const fiatTopUp = (
  ledger: DemoLedger,
  at: number,
  random: SeededRandom,
  buyRate: number,
  input: DemoPackInput
): DemoLedger => {
  const id = objectId(random)
  const amountUah = payoutUah(
    random,
    DemoHistoryShape.FIAT_TOP_UP_MIN_UAH,
    DemoHistoryShape.FIAT_TOP_UP_MAX_UAH
  )
  const cryptoCents = topUpCreditCents(amountUah, buyRate)
  const uploadedAt =
    at +
    random.between(DemoTimingMinutes.RECEIPT_DELAY_MIN, DemoTimingMinutes.RECEIPT_DELAY_MAX) *
      MINUTE_MS
  const completedAt =
    uploadedAt +
    random.between(DemoTimingSeconds.RECEIPT_READ_MIN, DemoTimingSeconds.RECEIPT_READ_MAX) *
      SECOND_MS

  const deposit: TmaFiatDeposit = {
    id,
    status: TmaFiatDepositStatus.COMPLETED,
    amountUah,
    cryptoCents,
    exchangeRate: buyRate,
    // Closed, so there is no card to pay — exactly what a real one sends.
    recipientCard: null,
    coveredUah: amountUah,
    payDeadlineAt: iso(at + input.payWindowMinutes * MINUTE_MS),
    receipts: [
      {
        id: objectId(random),
        status: TmaFiatReceiptStatus.ACCEPTED,
        rejection: null,
        amountUah,
        uploadedAt: iso(uploadedAt)
      }
    ],
    createdAt: iso(at),
    completedAt: iso(completedAt)
  }

  return {
    ...ledger,
    balanceCents: ledger.balanceCents + cryptoCents,
    history: [
      ...ledger.history,
      {
        type: 'fiat_deposit',
        id,
        amount: amountUah,
        cryptoCents,
        coveredUah: amountUah,
        status: TmaFiatDepositStatus.COMPLETED,
        createdAt: iso(at)
      }
    ],
    fiatDeposits: [...ledger.fiatDeposits, deposit],
    lots: [...ledger.lots, { usdtCents: cryptoCents, costUah: amountUah, at: new Date(at) }]
  }
}

/** USDT sent on chain and verified. */
const cryptoTopUp = (
  ledger: DemoLedger,
  at: number,
  random: SeededRandom,
  buyRate: number,
  input: DemoPackInput
): DemoLedger => {
  const id = objectId(random)
  const cryptoAmount = random.int(
    DemoHistoryShape.CRYPTO_TOP_UP_MIN_USDT,
    DemoHistoryShape.CRYPTO_TOP_UP_MAX_USDT
  )
  const fiatEquivalent = depositFiatEquivalent(cryptoAmount, buyRate)
  const credit = cryptoAmount * CENTS_PER_USDT

  const deposit: TmaDeposit = {
    _id: id,
    telegramId: input.telegramId,
    cryptoAmount,
    fiatEquivalent,
    exchangeRate: buyRate,
    status: TmaDepositStatus.COMPLETED,
    // No hash. The page never shows one, and a made-up hash is the one figure
    // here anybody could look up and find missing.
    txId: null,
    expiresAt: iso(at + input.depositExpiryMinutes * MINUTE_MS),
    verifiedAt: iso(
      at +
        random.between(DemoTimingMinutes.TX_CONFIRM_MIN, DemoTimingMinutes.TX_CONFIRM_MAX) *
          MINUTE_MS
    ),
    createdAt: iso(at)
  }

  return {
    ...ledger,
    balanceCents: ledger.balanceCents + credit,
    history: [
      ...ledger.history,
      {
        type: 'deposit',
        id,
        amount: fiatEquivalent,
        cryptoAmount,
        status: TmaDepositStatus.COMPLETED,
        createdAt: iso(at)
      }
    ],
    deposits: [...ledger.deposits, deposit],
    // Brought in from outside: what it cost is not ours to know, exactly as
    // for a real one.
    lots: [...ledger.lots, { usdtCents: credit, costUah: null, at: new Date(at) }]
  }
}

/** Referral earnings moved across, the 🎁 row. */
const referralTransfer = (
  ledger: DemoLedger,
  step: DemoStep,
  random: SeededRandom
): DemoLedger => ({
  ...ledger,
  balanceCents: ledger.balanceCents + step.cents,
  history: [
    ...ledger.history,
    {
      type: 'balance_movement',
      id: objectId(random),
      kind: BalanceEntryKind.REFERRAL_TRANSFER,
      cryptoCents: step.cents,
      createdAt: iso(step.at)
    }
  ],
  lots: [...ledger.lots, { usdtCents: step.cents, costUah: null, at: new Date(step.at) }]
})

/**
 * A share of the balance staked, priced, and filled in full.
 *
 * Skipped — the ledger returned as it was — when the balance cannot fund a
 * stake worth drawing, rather than drawing a sale of pennies.
 */
const sale = (
  ledger: DemoLedger,
  at: number,
  random: SeededRandom,
  sellRate: number,
  input: DemoPackInput
): DemoLedger => {
  const share = random.between(
    DemoHistoryShape.SALE_STAKE_MIN_SHARE,
    DemoHistoryShape.SALE_STAKE_MAX_SHARE
  )
  // Whole USDT, the way people type an amount to sell.
  const stakeCents = Math.floor((ledger.balanceCents * share) / CENTS_PER_USDT) * CENTS_PER_USDT
  if (stakeCents < DemoHistoryShape.SALE_MIN_STAKE_USDT * CENTS_PER_USDT) return ledger

  const method = random.chance(DemoHistoryShape.CARD_SALE_SHARE) ? SaleMethod.CARD : SaleMethod.JAR
  const bankType = random.pick(
    method === SaleMethod.JAR ? SALE_ENABLED_BANKS : CARD_SALE_ENABLED_BANKS
  )
  const { targetKopecks } = priceStake(stakeCents, sellRate)
  const isCard = method === SaleMethod.CARD
  // A card sale is sent orders no smaller than its own minimum; a jar sale
  // anything the pipeline routes.
  const floorKopecks = isCard
    ? saleCardMinOrderKopecks(targetKopecks, input.minOrderKopecks)
    : input.minOrderKopecks
  const maxPayments = isCard
    ? Math.min(
        DemoHistoryShape.SALE_MAX_PAYMENTS,
        saleCardMaxOrders(targetKopecks, input.minOrderKopecks)
      )
    : DemoHistoryShape.SALE_MAX_PAYMENTS
  const payments = splitTarget(
    random,
    targetKopecks,
    random.int(1, Math.max(1, maxPayments)),
    floorKopecks
  )
  const filled = fillPayments(random, at, payments, isCard)
  const completedAt =
    (filled.events.at(-1)?.at ?? at) +
    random.between(DemoTimingSeconds.COMPLETION_MIN, DemoTimingSeconds.COMPLETION_MAX) * SECOND_MS

  const id = objectId(random)
  const publicId = random.chars(PUBLIC_ID_ALPHABET, PUBLIC_ID_LENGTH)
  const remainderPolicy = defaultRemainderPolicy(method)
  const events: readonly SaleEvent[] = [
    { type: SaleEventType.TERMINAL_CREATED, at: at + DemoTimingSeconds.TERMINAL_READY * SECOND_MS },
    ...filled.events,
    { type: SaleEventType.COMPLETED, at: completedAt }
  ]

  const detail: TmaDemoSale = {
    sale: {
      _id: id,
      publicId,
      telegramId: input.telegramId,
      saleMethod: method,
      fiatAmount: targetKopecks,
      exchangeRate: sellRate,
      frozenUsdt: stakeCents,
      bankType,
      // Never shown, and a drawn jar address could be somebody's real jar.
      dropLink: '',
      status: TmaSaleStatus.COMPLETED,
      transactoTerminalId: random.int(DemoUpstreamIds.TERMINAL_MIN, DemoUpstreamIds.TERMINAL_MAX),
      cardId: random.int(DemoUpstreamIds.CARD_MIN, DemoUpstreamIds.CARD_MAX),
      receivedAmount: targetKopecks,
      remainderPolicy,
      refundedRemainderUsdt: 0,
      refundedRemainderFiat: 0,
      payoutCardTail: isCard ? random.chars(DIGITS, CARD_TAIL_LENGTH) : null,
      ...(isCard ? { cardOrders: filled.cardOrders } : {}),
      completedAt: iso(completedAt),
      createdAt: iso(at)
    },
    progress: {
      saleId: id,
      publicId,
      status: TmaSaleStatus.COMPLETED,
      targetAmount: targetKopecks,
      // A card sale has no jar to read, and says so the way a real one does.
      jarBalance: isCard ? null : targetKopecks,
      receivedAmount: targetKopecks,
      deliveredAmount: targetKopecks,
      pendingAmount: 0,
      events,
      blockReason: null,
      canCancel: false,
      awaitingJarClosure: false,
      remainderPolicy,
      refundedRemainderUsdt: 0,
      tail: null,
      ...(isCard
        ? {
            saleMethod: SaleMethod.CARD,
            cardOrders: filled.cardOrders,
            cardMinOrderKopecks: floorKopecks,
            cardMaxOrders: saleCardMaxOrders(targetKopecks, input.minOrderKopecks),
            statementRequired: false
          }
        : {}),
      updatedAt: completedAt
    }
  }

  return {
    ...ledger,
    balanceCents: ledger.balanceCents - stakeCents,
    turnoverKopecks: ledger.turnoverKopecks + targetKopecks,
    history: [
      ...ledger.history,
      {
        type: 'sale',
        id,
        publicId,
        amount: targetKopecks,
        stakeUsdtCents: stakeCents,
        bankType,
        saleMethod: method,
        status: TmaSaleStatus.COMPLETED,
        remainderPolicy,
        createdAt: iso(at)
      }
    ],
    sales: [...ledger.sales, detail],
    sold: [...ledger.sold, { usdtCents: stakeCents, receivedUah: targetKopecks, at: new Date(at) }]
  }
}

/**
 * A target cut into `count` payments of whole hryvnias, none below `floor`.
 *
 * Fewer than asked when the target cannot carry that many: at most half the
 * target's worth of floors, which is what guarantees the smallest share still
 * clears the floor however the weights fall.
 */
const splitTarget = (
  random: SeededRandom,
  targetKopecks: number,
  count: number,
  floorKopecks: number
): readonly number[] => {
  const parts = Math.max(1, Math.min(count, Math.floor(targetKopecks / (2 * floorKopecks))))
  const weights = Array.from({ length: parts }, () => random.between(1, 2))
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  const leading = weights
    .slice(0, -1)
    .map((weight) => roundToWholeUah((targetKopecks * weight) / total))

  return [...leading, targetKopecks - leading.reduce((sum, part) => sum + part, 0)]
}

/**
 * The timeline of a sale's payments, and a card sale's orders beside it.
 *
 * A jar sale's money is observed: an order arrives and the scraper matches it.
 * A card sale's is asserted: an order arrives, the seller confirms it, and it
 * is credited — `ORDER_RECEIVED` → `ORDER_CONFIRMED` → `PAYMENT_MATCHED`,
 * exactly as the real timeline records one.
 */
const fillPayments = (
  random: SeededRandom,
  at: number,
  payments: readonly number[],
  isCard: boolean
): { readonly events: readonly SaleEvent[]; readonly cardOrders: readonly SaleCardOrder[] } =>
  payments.reduce<{
    readonly cursor: number
    readonly events: readonly SaleEvent[]
    readonly cardOrders: readonly SaleCardOrder[]
  }>(
    (filled, amount) => {
      const orderId = random.int(DemoUpstreamIds.ORDER_MIN, DemoUpstreamIds.ORDER_MAX)
      const arrivedAt =
        filled.cursor +
        random.between(DemoTimingMinutes.PAYMENT_GAP_MIN, DemoTimingMinutes.PAYMENT_GAP_MAX) *
          MINUTE_MS
      const settledAt =
        arrivedAt +
        random.between(DemoTimingMinutes.MATCH_DELAY_MIN, DemoTimingMinutes.MATCH_DELAY_MAX) *
          MINUTE_MS

      return {
        cursor: settledAt,
        events: [
          ...filled.events,
          { type: SaleEventType.ORDER_RECEIVED, amount, orderId, at: arrivedAt },
          ...(isCard
            ? [{ type: SaleEventType.ORDER_CONFIRMED, amount, orderId, at: settledAt }]
            : []),
          { type: SaleEventType.PAYMENT_MATCHED, amount, at: settledAt + SECOND_MS }
        ],
        cardOrders: isCard
          ? [
              ...filled.cardOrders,
              {
                orderId,
                amount,
                state: SaleCardOrderState.CONFIRMED,
                arrivedAt: iso(arrivedAt),
                confirmDeadlineAt: iso(
                  arrivedAt + TMA_CARD_SALE_CONFIRM_WINDOW_MINUTES * MINUTE_MS
                ),
                answeredAt: iso(settledAt),
                statements: []
              }
            ]
          : filled.cardOrders
      }
    },
    { cursor: at, events: [], cardOrders: [] }
  )

// --- The offer and the card -------------------------------------------------

/** The amounts the top-up screen offers, cheapest first, priced at `buyRate`. */
const drawFiatOffer = (
  random: SeededRandom,
  buyRate: number,
  payWindowMinutes: number
): FiatDepositOptionsResponse => {
  const amounts = [
    ...new Set(
      Array.from({ length: DemoFiatOfferShape.COUNT }, () =>
        payoutUah(random, DemoFiatOfferShape.MIN_UAH, DemoFiatOfferShape.MAX_UAH)
      )
    )
  ].toSorted((left, right) => left - right)

  return {
    options: amounts
      .map((amountUah) => ({
        amountUah,
        cryptoCents: topUpCreditCents(amountUah, buyRate)
      }))
      .filter((option) => option.cryptoCents >= MIN_USDT_CENTS),
    exchangeRate: buyRate,
    // An account with this history has settled deposits, and the first-deposit
    // ceiling lifted long ago.
    maxAmountUah: null,
    payWindowMinutes,
    bookAvailable: true,
    watch: null,
    activeDepositId: null
  }
}

/**
 * Sixteen digits that read as a card and fail the Luhn check.
 *
 * Every banking app runs that check before it sends anything, so a viewer who
 * copies this out of an advertisement is refused on the spot. One digit is
 * the check digit; moving it by one is enough to break the sum.
 */
const unpayableCard = (random: SeededRandom): string => {
  const drawn = `${random.pick(DEMO_CARD_NETWORK_PREFIXES)}${random.chars(DIGITS, CARD_NUMBER_LENGTH - 1)}`
  if (!isLuhnValid(drawn)) return drawn

  return `${drawn.slice(0, -1)}${(Number(drawn.at(-1)) + 1) % DIGITS.length}`
}
