import { TestBed } from '@angular/core/testing'
import { HttpStatusCode } from '@angular/common/http'
import { provideZonelessChangeDetection } from '@angular/core'
import { Store, provideStore } from '@ngrx/store'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  ERROR,
  SaleMethod,
  SaleRemainderPolicy,
  TmaDepositStatus,
  TmaFiatDepositStatus,
  TmaSaleStatus,
  TrustLevel,
  BankProvider,
  type AuthResponse,
  type CreateSaleReq,
  type TmaDemoPack
} from '@transacto/contracts'
import { AUTH_FEATURE } from '../../auth/store/auth.state'
import { authReducer } from '../../auth/store/auth.reducer'
import { authActions } from '../../auth/store/auth.actions'
import { RATES_FEATURE } from '../../core/store/rates.state'
import { ratesReducer } from '../../core/store/rates.reducer'
import { ratesActions } from '../../core/store/rates.actions'
import { DemoAnswerKind } from '../enums/demo-answer-kind.enum'
import type { DemoAnswer, DemoRespondAnswer } from '../interfaces/demo-answer.interface'
import { DemoModeService } from './demo-mode.service'

const TELEGRAM_ID = 700_100_200
const PACK_SELL_RATE = 4_681
const PACK_BUY_RATE = 4_566
/**
 * Whatever the pack carries — the server draws one that fails the Luhn check,
 * and all the device has to do is show that one and no other.
 */
const UNPAYABLE_CARD = 'the-pack-s-own-unpayable-card'

const pack: TmaDemoPack = {
  profile: {
    user: {
      telegramId: TELEGRAM_ID,
      firstName: 'Олена',
      lastName: '',
      username: '',
      balance: 49_382,
      frozenBalance: 0,
      totalTurnover: 17_492_900,
      isActive: true,
      referralBalance: 1_223,
      totalReferralEarned: 4_076,
      showNameToReferrer: false
    },
    trustLevel: TrustLevel.EXPERIENCED,
    maxParallelOrders: 3,
    slotsAwaitingJarClosure: []
  },
  history: [],
  referral: {
    code: 'Z38SL69F',
    link: 'deep-link-carrying-Z38SL69F',
    ratePercent: 0.1,
    balance: 1_223,
    totalEarned: 4_076,
    totalVolume: 190_839_200,
    invitedBy: null,
    canRedeemCode: false,
    referrals: []
  },
  income: {
    fromFiat: { soldUsdtCents: 0, spentUah: 0, receivedUah: 0, profitUah: 0 },
    fromOwnUsdt: { soldUsdtCents: 0, receivedUah: 0, averageSellRate: 0 }
  },
  trustLadder: { levels: [] },
  saleConfig: {
    trustLevel: TrustLevel.EXPERIENCED,
    maxParallelOrders: 3,
    openOrders: 0,
    slotsAwaitingJarClosure: [],
    sellRate: PACK_SELL_RATE,
    balance: 49_382,
    minOrderKopecks: 30_000
  },
  depositConfig: {
    walletAddress: 'T_WALLET_NOT_A_REAL_ADDRESS',
    exchangeRate: PACK_BUY_RATE,
    expiryMinutes: 60
  },
  fiatOptions: {
    options: [{ amountUah: 1_000_000, cryptoCents: 21_900 }],
    exchangeRate: PACK_BUY_RATE,
    maxAmountUah: null,
    payWindowMinutes: 15,
    bookAvailable: true,
    watch: null,
    activeDepositId: null
  },
  sales: [
    {
      sale: {
        _id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
        publicId: 'Q7M2K9TX',
        telegramId: TELEGRAM_ID,
        saleMethod: SaleMethod.JAR,
        fiatAmount: 1_000_000,
        exchangeRate: PACK_SELL_RATE,
        frozenUsdt: 21_363,
        bankType: BankProvider.PRIVAT,
        dropLink: '',
        status: TmaSaleStatus.COMPLETED,
        transactoTerminalId: 4_321,
        cardId: 54_321,
        receivedAmount: 1_000_000,
        remainderPolicy: SaleRemainderPolicy.REFUND_TO_BALANCE,
        completedAt: '2026-09-20T14:00:00.000Z',
        createdAt: '2026-09-20T13:00:00.000Z'
      },
      progress: {
        saleId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
        publicId: 'Q7M2K9TX',
        status: TmaSaleStatus.COMPLETED,
        targetAmount: 1_000_000,
        jarBalance: 1_000_000,
        receivedAmount: 1_000_000,
        deliveredAmount: 1_000_000,
        pendingAmount: 0,
        events: [],
        blockReason: null,
        canCancel: false,
        awaitingJarClosure: false,
        remainderPolicy: SaleRemainderPolicy.REFUND_TO_BALANCE,
        refundedRemainderUsdt: 0,
        tail: null,
        updatedAt: Date.parse('2026-09-20T14:00:00.000Z')
      }
    }
  ],
  deposits: [
    {
      _id: 'bbbbbbbbbbbbbbbbbbbbbbbb',
      telegramId: TELEGRAM_ID,
      cryptoAmount: 500,
      fiatEquivalent: 2_283_000,
      exchangeRate: PACK_BUY_RATE,
      status: TmaDepositStatus.COMPLETED,
      txId: null,
      expiresAt: '2026-09-10T11:00:00.000Z',
      verifiedAt: '2026-09-10T10:10:00.000Z',
      createdAt: '2026-09-10T10:00:00.000Z'
    }
  ],
  fiatDeposits: [
    {
      id: 'cccccccccccccccccccccccc',
      status: TmaFiatDepositStatus.COMPLETED,
      amountUah: 1_000_000,
      cryptoCents: 21_900,
      exchangeRate: PACK_BUY_RATE,
      recipientCard: null,
      coveredUah: 1_000_000,
      payDeadlineAt: '2026-09-12T10:15:00.000Z',
      receipts: [],
      createdAt: '2026-09-12T10:00:00.000Z',
      completedAt: '2026-09-12T10:08:00.000Z'
    }
  ],
  recipientCard: UNPAYABLE_CARD
}

const session = (demo: TmaDemoPack | undefined): AuthResponse => ({
  user: pack.profile.user,
  trustLevel: { level: TrustLevel.EXPERIENCED, maxParallelOrders: 3 },
  isNewUser: false,
  ...(demo === undefined ? {} : { demo })
})

const bodyOf = <T>(answer: DemoAnswer): T => {
  expect(answer.kind).toBe(DemoAnswerKind.RESPOND)

  return (answer as DemoRespondAnswer).body as T
}

/**
 * The demo answers a promoter's screens on the phone, so what matters is that
 * every answer is one the real server could have given this account — and that
 * nothing it would have to change is ever let through.
 */
describe('DemoModeService', () => {
  let store: Store
  let demo: DemoModeService

  const open = (withPack: TmaDemoPack | undefined): void => {
    store.dispatch(authActions.authenticateSuccess({ session: session(withPack) }))
  }

  const ask = (method: string, path: string, body: unknown = null): DemoAnswer =>
    demo.answer({ method, path, body })

  beforeEach(() => {
    TestBed.resetTestingModule()
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideStore({ [AUTH_FEATURE]: authReducer, [RATES_FEATURE]: ratesReducer })
      ]
    })

    store = TestBed.inject(Store)
    demo = TestBed.inject(DemoModeService)
  })

  it('stays out of the way of an ordinary account', () => {
    open(undefined)

    expect(demo.active()).toBe(false)
    expect(ask('GET', '/user/profile').kind).toBe(DemoAnswerKind.NETWORK)
    expect(ask('POST', '/sales').kind).toBe(DemoAnswerKind.NETWORK)
  })

  describe('for a demo account', () => {
    beforeEach(() => open(pack))

    it('sends the launch, the rates and a pasted jar to the server', () => {
      expect(ask('POST', '/auth').kind).toBe(DemoAnswerKind.NETWORK)
      expect(ask('GET', '/rates').kind).toBe(DemoAnswerKind.NETWORK)
      expect(ask('POST', '/sales/resolve-link').kind).toBe(DemoAnswerKind.NETWORK)
    })

    it('answers its screens from the pack', () => {
      expect(bodyOf(ask('GET', '/user/profile'))).toEqual(pack.profile)
      expect(bodyOf(ask('GET', '/referral'))).toEqual(pack.referral)
      expect(bodyOf(ask('GET', '/user/balance-history'))).toEqual({ history: pack.history })
    })

    it('opens a sale from the history, and knows `/sales/config` is not a sale', () => {
      const id = pack.sales[0].sale._id

      expect(bodyOf(ask('GET', `/sales/${id}`))).toEqual({ order: pack.sales[0].sale })
      expect(bodyOf(ask('GET', `/sales/${id}/progress`))).toEqual(pack.sales[0].progress)
      expect(bodyOf<{ sellRate: number }>(ask('GET', '/sales/config')).sellRate).toBe(
        PACK_SELL_RATE
      )
    })

    it('answers an id it never made the way the server does', () => {
      const answer = ask('GET', '/sales/ffffffffffffffffffffffff')

      expect(answer).toMatchObject({
        kind: DemoAnswerKind.REFUSE,
        status: HttpStatusCode.NotFound,
        error: ERROR.SALE.NOT_FOUND
      })
    })

    it('prices the sale form and the top-up offer at the rates on the dashboard now', () => {
      store.dispatch(ratesActions.loadSuccess({ rates: { buy: 4_600, sell: 4_700 } }))

      expect(bodyOf<{ sellRate: number }>(ask('GET', '/sales/config')).sellRate).toBe(4_700)
      expect(bodyOf<{ exchangeRate: number }>(ask('GET', '/deposits/config')).exchangeRate).toBe(
        4_600
      )
      expect(
        bodyOf<{ exchangeRate: number; options: { cryptoCents: number }[] }>(
          ask('GET', '/fiat-deposits/options')
        )
      ).toMatchObject({ exchangeRate: 4_600, options: [{ cryptoCents: 21_739 }] })
    })

    it('acts a sale out with the form’s own figures, and opens it', () => {
      const request: CreateSaleReq = {
        saleMethod: SaleMethod.CARD,
        fiatAmount: 468_000,
        stakeCents: 10_000,
        bankType: BankProvider.MONO,
        cardNumber: '4000 0000 0000 0002',
        receiverName: 'Олена К.',
        quotedRate: 4_680,
        remainderPolicy: SaleRemainderPolicy.REFUND_TO_BALANCE
      }

      const created = bodyOf<{ saleId: string; fiatAmount: number }>(ask('POST', '/sales', request))
      const { order } = bodyOf<{
        order: { frozenUsdt: number; exchangeRate: number; payoutCardTail: string }
      }>(ask('GET', `/sales/${created.saleId}`))
      const progress = bodyOf<{ status: TmaSaleStatus; targetAmount: number }>(
        ask('GET', `/sales/${created.saleId}/progress`)
      )

      expect(created.fiatAmount).toBe(468_000)
      expect(order).toMatchObject({
        frozenUsdt: 10_000,
        exchangeRate: 4_680,
        payoutCardTail: '0002'
      })
      expect(progress).toMatchObject({
        status: TmaSaleStatus.TERMINAL_READY,
        targetAmount: 468_000
      })
    })

    it('does not write the acted-out sale into the history', () => {
      ask('POST', '/sales', {
        fiatAmount: 468_000,
        quotedRate: 4_680,
        bankType: BankProvider.PRIVAT
      })

      expect(bodyOf(ask('GET', '/user/balance-history'))).toEqual({ history: pack.history })
      expect(bodyOf(ask('GET', '/user/profile'))).toEqual(pack.profile)
    })

    it('reserves a top-up on a card no bank will pay', () => {
      const reserved = bodyOf<{ id: string; recipientCard: string; status: TmaFiatDepositStatus }>(
        ask('POST', '/fiat-deposits', { amountUah: 1_000_000 })
      )

      expect(reserved).toMatchObject({
        recipientCard: UNPAYABLE_CARD,
        status: TmaFiatDepositStatus.RESERVED
      })
      expect(bodyOf(ask('GET', `/fiat-deposits/${reserved.id}`))).toEqual(reserved)
    })

    it('points a USDT deposit at the real wallet', () => {
      const created = bodyOf<{ depositId: string; walletAddress: string }>(
        ask('POST', '/deposits', { cryptoAmount: 150 })
      )

      expect(created.walletAddress).toBe('T_WALLET_NOT_A_REAL_ADDRESS')
      expect(
        bodyOf<{ deposit: { status: TmaDepositStatus } }>(
          ask('GET', `/deposits/${created.depositId}`)
        ).deposit.status
      ).toBe(TmaDepositStatus.PENDING)
    })

    it.each([
      ['POST', '/referral/transfer'],
      ['POST', '/sales/aaaaaaaaaaaaaaaaaaaaaaaa/cancel'],
      ['POST', '/fiat-deposits/cccccccccccccccccccccccc/receipts'],
      ['DELETE', '/fiat-deposits/watch']
    ])('refuses %s %s, with the code the dictionaries translate', (method, path) => {
      expect(ask(method, path)).toMatchObject({
        kind: DemoAnswerKind.REFUSE,
        status: HttpStatusCode.Forbidden,
        error: ERROR.TMA_DEMO.READ_ONLY
      })
    })

    it('refuses what it was never told about, rather than letting it through', () => {
      expect(ask('GET', '/something/new').kind).toBe(DemoAnswerKind.REFUSE)
      expect(ask('POST', '/something/new').kind).toBe(DemoAnswerKind.REFUSE)
    })
  })
})
