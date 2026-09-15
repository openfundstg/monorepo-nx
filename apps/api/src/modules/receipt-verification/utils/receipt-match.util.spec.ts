import { BankProvider } from '@transacto/contracts'
import { ReceiptMismatch } from '../enums'
import type { AttestedReceipt, ReceiptExpectation } from '../interfaces'
import { matchReceipt } from './receipt-match.util'

const RESERVED_AT = new Date('2026-09-06T10:00:00Z')
const DEADLINE_AT = new Date('2026-09-06T10:15:00Z')

const expectation = (overrides: Partial<ReceiptExpectation> = {}): ReceiptExpectation => ({
  amountUah: 3600,
  recipientCard: '4441118888888671',
  paidNotBefore: RESERVED_AT,
  paidNotAfter: DEADLINE_AT,
  ...overrides
})

const receipt = (overrides: Partial<AttestedReceipt> = {}): AttestedReceipt => ({
  bank: BankProvider.MONO,
  code: '297X-351K-C1T2-BKMB',
  amountUah: 3600,
  paidAt: new Date('2026-09-06T10:06:45Z'),
  currencyCode: 980,
  recipient: 'Ілля К., 444111******8671',
  documentUrl: 'https://api.monobank.ua/bank/receipt/whatever',
  ...overrides
})

describe('matchReceipt', () => {
  it('accepts the payment the payout is waiting for', () => {
    expect(matchReceipt(receipt(), expectation())).toEqual([])
  })

  it.each([
    ['a smaller sum', { amountUah: 3599 }, ReceiptMismatch.AMOUNT],
    ['a sum past what a fee could explain', { amountUah: 3781 }, ReceiptMismatch.AMOUNT],
    ['a different card', { recipient: 'Хтось, 512345******9999' }, ReceiptMismatch.RECIPIENT],
    ['a recipient with no card', { recipient: 'Ілля К.' }, ReceiptMismatch.RECIPIENT_UNREADABLE],
    [
      'a recipient stated as an account',
      { recipient: 'UA620000000000000000000000001' },
      ReceiptMismatch.RECIPIENT_NOT_A_CARD
    ],
    [
      'a transfer made before the payout existed',
      { paidAt: new Date('2026-09-06T09:59:59Z') },
      ReceiptMismatch.PAID_TOO_EARLY
    ],
    [
      'a transfer made after the window closed',
      { paidAt: new Date('2026-09-06T10:15:01Z') },
      ReceiptMismatch.PAID_TOO_LATE
    ]
  ])('refuses %s', (_name, overrides, reason) => {
    expect(matchReceipt(receipt(overrides), expectation())).toContain(reason)
  })

  /**
   * Without this, the amount comparison is a comparison of two bare numbers:
   * ₴3 600 would be settled by $36.00, the receipt would be real, the code would
   * verify, and the figures would agree.
   */
  it('refuses a payment in another currency for the same number', () => {
    expect(matchReceipt(receipt({ currencyCode: 840 }), expectation())).toContain(
      ReceiptMismatch.CURRENCY
    )
  })

  /**
   * Both boundaries are inclusive: somebody who pays in the first or the last
   * second of their own window has paid inside it.
   */
  it.each([RESERVED_AT, DEADLINE_AT])('accepts a transfer made exactly at %s', (paidAt) => {
    expect(matchReceipt(receipt({ paidAt }), expectation())).toEqual([])
  })

  /**
   * An operator reading a refusal wants to know whether one thing was off or
   * nothing matched at all — the first is a mistake, the second is somebody
   * trying it on.
   */
  it('reports every disagreement, not the first', () => {
    const wrong = receipt({ amountUah: 1, currencyCode: 840, recipient: 'X, 512345******9999' })

    expect(matchReceipt(wrong, expectation())).toEqual([
      ReceiptMismatch.AMOUNT,
      ReceiptMismatch.CURRENCY,
      ReceiptMismatch.RECIPIENT
    ])
  })
})

/**
 * The recipient stated in full rather than masked, which is how a PrivatBank
 * receipt names it when the money left PrivatBank.
 *
 * Worth its own block because it is the *stronger* of the two comparisons and
 * reads like the weaker one: `matchesMaskedCard` compares position by position,
 * so a run with no asterisks compares every digit and one wrong digit refuses.
 */
/**
 * The two sides of the timing check are read at different resolutions, and for
 * a while nothing accounted for that.
 *
 * A receipt states `HH:mm`; a reservation knows the second. So a payment made
 * seconds after the payout was reserved states a time *before* it, and was
 * refused as a reuse — a reservation at second N refused every payment in the
 * following `60 − N` seconds. It penalised exactly the users who paid fastest,
 * and it happened in production: a genuine, signed, exact receipt was refused
 * PAID_TOO_EARLY and the user was credited three hours later, by hand.
 */
describe('matchReceipt — a receipt states only the minute', () => {
  /** 03:02:22.627 — the reservation from the incident, to the millisecond. */
  const RESERVED_MID_MINUTE = new Date('2026-09-06T10:02:22.627Z')

  const midMinute = (overrides: Partial<AttestedReceipt> = {}) =>
    matchReceipt(receipt(overrides), expectation({ paidNotBefore: RESERVED_MID_MINUTE }))

  it('accepts a payment stamped with the minute the payout was reserved in', () => {
    expect(midMinute({ paidAt: new Date('2026-09-06T10:02:00Z') })).toEqual([])
  })

  /**
   * The reuse the check exists for is untouched: an older payment is older by
   * whole minutes, and every one of them still fails.
   */
  it('still refuses the minute before it', () => {
    expect(midMinute({ paidAt: new Date('2026-09-06T10:01:00Z') })).toContain(
      ReceiptMismatch.PAID_TOO_EARLY
    )
  })

  /** Nothing moves when the reservation already sits on a whole minute. */
  it('changes nothing for a reservation on the minute', () => {
    expect(
      matchReceipt(receipt({ paidAt: new Date('2026-09-06T09:59:00Z') }), expectation())
    ).toContain(ReceiptMismatch.PAID_TOO_EARLY)
  })

  /**
   * The mirror bug, and the reason the late bound is left exact. Truncation
   * only ever moves a stated time earlier, so flooring the deadline too would
   * refuse a payment genuinely made inside the window.
   */
  it('accepts a payment stamped with the minute the window closes in', () => {
    expect(
      matchReceipt(
        receipt({ paidAt: new Date('2026-09-06T10:15:00Z') }),
        expectation({ paidNotAfter: new Date('2026-09-06T10:15:22Z') })
      )
    ).toEqual([])
  })

  it('still refuses the minute after the window closed', () => {
    expect(
      matchReceipt(
        receipt({ paidAt: new Date('2026-09-06T10:16:00Z') }),
        expectation({ paidNotAfter: new Date('2026-09-06T10:15:22Z') })
      )
    ).toContain(ReceiptMismatch.PAID_TOO_LATE)
  })
})

describe('matchReceipt — an unmasked recipient', () => {
  const card = '4441110000005500'

  it('accepts the card it was paid to', () => {
    const paid = receipt({ recipient: card })

    expect(matchReceipt(paid, expectation({ recipientCard: card }))).toEqual([])
  })

  it('refuses a card that differs by one digit', () => {
    const paid = receipt({ recipient: card })
    const almost = `${card.slice(0, 15)}1`

    expect(matchReceipt(paid, expectation({ recipientCard: almost }))).toContain(
      ReceiptMismatch.RECIPIENT
    )
  })

  /**
   * PrivatBank prints an IBAN whenever the transfer stays inside PrivatBank,
   * and nothing derives a card from one. It is a refusal, and it is deliberately
   * not `RECIPIENT` — the payment may well be this payout's, and only a person
   * can say.
   */
  it('refuses an account without claiming it went to the wrong card', () => {
    const paid = receipt({ recipient: 'UA620000000000000000000000001' })
    const reasons = matchReceipt(paid, expectation({ recipientCard: card }))

    expect(reasons).toEqual([ReceiptMismatch.RECIPIENT_NOT_A_CARD])
  })
})

/**
 * **A transfer fee is the payer's, and some banks put it inside the amount.**
 *
 * A monobank receipt for a ₴1 470 top-up read `Сума (грн) 1 477.39` — ₴7.39 the
 * payer chose to cover for the recipient — and ₴1 470 appeared nowhere on the
 * document. Exact equality sent a correct payment to an operator.
 *
 * The allowance is upward only. A receipt for less is an underpayment, which is
 * what the amount check exists to catch, and stays a refusal at one kopeck
 * below.
 */
describe('matchReceipt — a fee the payer covered', () => {
  /** The case that prompted this, to the kopeck. */
  it('accepts the ₴1 477.39 receipt for a ₴1 470 payout', () => {
    const matched = matchReceipt(receipt({ amountUah: 147739 }), expectation({ amountUah: 147000 }))

    expect(matched).toEqual([])
  })

  it('accepts a fee exactly at the limit', () => {
    // 5% of 3600 is 180 kopecks, and the boundary belongs on the passing side.
    expect(matchReceipt(receipt({ amountUah: 3780 }), expectation())).toEqual([])
  })

  it('refuses one kopeck past it', () => {
    expect(matchReceipt(receipt({ amountUah: 3781 }), expectation())).toEqual([
      ReceiptMismatch.AMOUNT
    ])
  })

  it.each([
    ['one kopeck', 3599],
    ['a hundred hryvnia', 3600 - 10000]
  ])('still refuses an underpayment by %s', (_name, amountUah) => {
    expect(matchReceipt(receipt({ amountUah }), expectation())).toEqual([ReceiptMismatch.AMOUNT])
  })

  /**
   * The allowance rides on the *outstanding* amount, not the payout's full one:
   * a top-up already half covered is waiting for the rest, and a fee on the rest
   * is proportionally smaller.
   */
  it('scales with what is still outstanding', () => {
    const outstanding = expectation({ amountUah: 30000 })

    expect(matchReceipt(receipt({ amountUah: 31500 }), outstanding)).toEqual([])
    expect(matchReceipt(receipt({ amountUah: 31501 }), outstanding)).toEqual([
      ReceiptMismatch.AMOUNT
    ])
  })

  /** A fee does not excuse anything else being wrong. */
  it('does not soften the other three checks', () => {
    const matched = matchReceipt(
      receipt({ amountUah: 3700, recipient: 'Хтось, 512345******9999' }),
      expectation()
    )

    expect(matched).toEqual([ReceiptMismatch.RECIPIENT])
  })
})
