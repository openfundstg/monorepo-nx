import {
  SaleEventType,
  SaleMethod,
  TmaDepositStatus,
  TmaFiatDepositStatus,
  TmaSaleStatus,
  cardTail,
  defaultRemainderPolicy,
  depositFiatEquivalent,
  priceSale,
  saleCardMaxOrders,
  saleCardMinOrderKopecks,
  topUpCreditCents,
  type CreateDepositResponse,
  type CreateSaleReq,
  type DepositConfigResponse,
  type FiatDepositOptionsResponse,
  type TmaDemoSale,
  type TmaDeposit,
  type TmaFiatDeposit
} from '@transacto/contracts'
import { MINUTE_MS } from '../constants/demo-time.const'

/** What a prop needs drawn at the moment it is made: its ids and its moment. */
export interface DemoMint {
  /** A Mongo-shaped id, as every route segment the app builds carries. */
  readonly id: string
  /** The code a sale shows and a user quotes. */
  readonly publicId: string
  /** Epoch milliseconds. */
  readonly now: number
}

const iso = (epochMs: number): string => new Date(epochMs).toISOString()

/**
 * A sale as it stands the moment after it was created — its terminal ready,
 * nothing paid yet.
 *
 * Every figure is the form's own: the total and the stake it sent, at the rate
 * it quoted. That is what makes the page that opens next agree to the kopeck
 * with the form the viewer just watched being filled in.
 */
export const demoSale = (
  request: CreateSaleReq,
  mint: DemoMint,
  telegramId: number,
  minOrderKopecks: number
): TmaDemoSale => {
  const method = request.saleMethod ?? SaleMethod.JAR
  const isCard = method === SaleMethod.CARD
  const remainderPolicy = request.remainderPolicy ?? defaultRemainderPolicy(method)
  // The form always sends the stake; a request without one is priced the way
  // the server prices it, from the total.
  const stakeCents =
    request.stakeCents ?? priceSale(request.fiatAmount, request.quotedRate).requiredUsdtCents
  const status = TmaSaleStatus.TERMINAL_READY

  return {
    sale: {
      _id: mint.id,
      publicId: mint.publicId,
      telegramId,
      saleMethod: method,
      fiatAmount: request.fiatAmount,
      exchangeRate: request.quotedRate,
      frozenUsdt: stakeCents,
      bankType: request.bankType,
      dropLink: request.dropLink ?? '',
      status,
      // Transacto's numbers, which nothing on the page shows and nothing here has.
      transactoTerminalId: null,
      cardId: null,
      receivedAmount: 0,
      remainderPolicy,
      refundedRemainderUsdt: 0,
      refundedRemainderFiat: 0,
      // Four digits, as a real sale keeps — never the sixteen the form was given.
      payoutCardTail: isCard ? cardTail(request.cardNumber) : null,
      ...(isCard ? { cardOrders: [] } : {}),
      completedAt: null,
      createdAt: iso(mint.now)
    },
    progress: {
      saleId: mint.id,
      publicId: mint.publicId,
      status,
      targetAmount: request.fiatAmount,
      // Not read yet, as a jar is not in the first seconds of a real sale.
      jarBalance: null,
      receivedAmount: 0,
      deliveredAmount: 0,
      pendingAmount: 0,
      events: [{ type: SaleEventType.TERMINAL_CREATED, at: mint.now }],
      blockReason: null,
      canCancel: true,
      awaitingJarClosure: false,
      remainderPolicy,
      refundedRemainderUsdt: 0,
      tail: null,
      ...(isCard
        ? {
            saleMethod: SaleMethod.CARD,
            cardOrders: [],
            cardMinOrderKopecks: saleCardMinOrderKopecks(request.fiatAmount, minOrderKopecks),
            cardMaxOrders: saleCardMaxOrders(request.fiatAmount, minOrderKopecks),
            statementRequired: false
          }
        : {}),
      updatedAt: mint.now
    }
  }
}

/**
 * A USDT deposit waiting for its transfer, to the **real** wallet.
 *
 * Real on purpose: it is the address every user is shown, and somebody who
 * sends to it from an advertisement has sent money to this product, which
 * support can find — unlike an invented address, which would lose it.
 */
export const demoDeposit = (
  cryptoAmount: number,
  mint: DemoMint,
  config: DepositConfigResponse,
  telegramId: number
): { readonly created: CreateDepositResponse; readonly deposit: TmaDeposit } => {
  const fiatEquivalent = depositFiatEquivalent(cryptoAmount, config.exchangeRate)
  const expiresAt = iso(mint.now + config.expiryMinutes * MINUTE_MS)
  const status = TmaDepositStatus.PENDING

  return {
    created: {
      depositId: mint.id,
      cryptoAmount,
      fiatEquivalent,
      exchangeRate: config.exchangeRate,
      walletAddress: config.walletAddress,
      expiresAt,
      status
    },
    deposit: {
      _id: mint.id,
      telegramId,
      cryptoAmount,
      fiatEquivalent,
      exchangeRate: config.exchangeRate,
      status,
      txId: null,
      expiresAt,
      verifiedAt: null,
      createdAt: iso(mint.now)
    }
  }
}

/**
 * A hryvnia top-up just reserved: the sum to transfer, a card, and a clock.
 *
 * The card is the pack's, which fails the Luhn check — see
 * `TmaDemoPack.recipientCard` for why it must.
 */
export const demoFiatDeposit = (
  amountUah: number,
  mint: DemoMint,
  offer: FiatDepositOptionsResponse,
  recipientCard: string
): TmaFiatDeposit => ({
  id: mint.id,
  status: TmaFiatDepositStatus.RESERVED,
  amountUah,
  cryptoCents: topUpCreditCents(amountUah, offer.exchangeRate),
  exchangeRate: offer.exchangeRate,
  recipientCard,
  coveredUah: 0,
  payDeadlineAt: iso(mint.now + offer.payWindowMinutes * MINUTE_MS),
  receipts: [],
  createdAt: iso(mint.now),
  completedAt: null
})
