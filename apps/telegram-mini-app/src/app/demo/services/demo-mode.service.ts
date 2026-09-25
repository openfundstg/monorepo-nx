import { HttpStatusCode } from '@angular/common/http'
import { Injectable, computed, inject, signal } from '@angular/core'
import { Store } from '@ngrx/store'
import {
  ERROR,
  OBJECT_ID_ALPHABET,
  OBJECT_ID_LENGTH,
  PUBLIC_ID_ALPHABET,
  PUBLIC_ID_LENGTH,
  type ApiError,
  type BalanceHistoryResponse,
  type CreateDepositReq,
  type CreateDepositResponse,
  type CreateFiatDepositReq,
  type CreateSaleReq,
  type CreateSaleResponse,
  type DepositConfigResponse,
  type DepositDetailResponse,
  type DepositListResponse,
  type FiatDepositOptionsResponse,
  type FiatDepositWatch,
  type IncomeAnalyticsResponse,
  type ReferralSummary,
  type SaleConfigResponse,
  type SaleDetailResponse,
  type SaleListResponse,
  type SaleProgress,
  type TmaDemoPack,
  type TmaDemoSale,
  type TmaDeposit,
  type TmaFiatDeposit,
  type TrustLevelLadderResponse,
  type UserProfileResponse
} from '@transacto/contracts'
import { selectDemoPack } from '../../auth/store/auth.selectors'
import { selectBuyRate, selectSellRate } from '../../core/store/rates.selectors'
import { DEMO_ROUTES } from '../constants/demo-routes.const'
import { DemoAnswerKind } from '../enums/demo-answer-kind.enum'
import { DemoEndpoint } from '../enums/demo-endpoint.enum'
import { DemoLatencyMs } from '../enums/demo-timing.enum'
import type { DemoAnswer, DemoRequest } from '../interfaces/demo-answer.interface'
import { matchDemoRoute } from '../utils/demo-route.util'
import { demoDeposit, demoFiatDeposit, demoSale, type DemoMint } from '../utils/demo-prop.util'
import { pricedDepositConfig, pricedFiatOffer, pricedSaleConfig } from '../utils/demo-pricing.util'

/** What this session acted out, by id: made on the device, never sent. */
interface DemoProps {
  readonly sales: Readonly<Record<string, TmaDemoSale>>
  readonly deposits: Readonly<Record<string, TmaDeposit>>
  readonly fiatDeposits: Readonly<Record<string, TmaFiatDeposit>>
}

const NO_PROPS: DemoProps = { sales: {}, deposits: {}, fiatDeposits: {} }

const NETWORK: DemoAnswer = { kind: DemoAnswerKind.NETWORK }

type DemoHandler = (
  pack: TmaDemoPack,
  params: Readonly<Record<string, string>>,
  body: unknown
) => DemoAnswer

/**
 * Answers a demo account's requests on the device.
 *
 * The account's history arrives once, with `/auth`; from then on every screen
 * that would have asked the server for a figure is answered from it here, and
 * every button that would have started something is acted out — the form
 * submits, the page that follows opens, and nothing leaves the phone. Only the
 * launch, the live rates and reading a pasted jar go to the network; see
 * {@link DEMO_ROUTES}.
 *
 * **Not a security boundary.** The server refuses a demo account's writes by
 * itself, whatever this does or fails to do. This is what makes the refusals
 * unnecessary, and the screens quick.
 *
 * What the session acts out is held in memory and nowhere else — not in
 * Telegram's cloud storage, which follows the account onto every device — so
 * closing the app forgets it, and switching the demo off in the panel takes
 * effect on the next open.
 */
@Injectable({ providedIn: 'root' })
export class DemoModeService {
  private readonly store = inject(Store)
  private readonly pack = this.store.selectSignal(selectDemoPack)
  private readonly liveSellRate = this.store.selectSignal(selectSellRate)
  private readonly liveBuyRate = this.store.selectSignal(selectBuyRate)

  private readonly props = signal<DemoProps>(NO_PROPS)

  readonly active = computed(() => this.pack() !== null)

  /**
   * One answer per endpoint, and no fallback: an endpoint added to the enum
   * does not compile until this says what the demo does with it.
   *
   * Every body is written against the contract its endpoint answers with —
   * `respond<SaleDetailResponse>(…)` — so a field added to a contract fails the
   * build here too, rather than surfacing as an `undefined` in a recording.
   */
  private readonly handlers: Readonly<Record<DemoEndpoint, DemoHandler>> = {
    [DemoEndpoint.AUTH]: () => NETWORK,
    [DemoEndpoint.RATES]: () => NETWORK,
    [DemoEndpoint.RESOLVE_JAR_LINK]: () => NETWORK,

    [DemoEndpoint.PROFILE]: (pack) => read<UserProfileResponse>(pack.profile),
    [DemoEndpoint.HISTORY]: (pack) => read<BalanceHistoryResponse>({ history: [...pack.history] }),
    [DemoEndpoint.REFERRAL]: (pack) => read<ReferralSummary>(pack.referral),
    [DemoEndpoint.INCOME]: (pack) => read<IncomeAnalyticsResponse>(pack.income),
    [DemoEndpoint.TRUST_LADDER]: (pack) => read<TrustLevelLadderResponse>(pack.trustLadder),
    [DemoEndpoint.SALE_CONFIG]: (pack) => read<SaleConfigResponse>(this.saleConfig(pack)),
    [DemoEndpoint.SALE_LIST]: (pack) =>
      read<SaleListResponse>({ orders: this.sales(pack).map((detail) => detail.sale) }),
    [DemoEndpoint.SALE_DETAIL]: (pack, params) =>
      this.detail(this.findSale(pack, params['id']), ERROR.SALE.NOT_FOUND, (detail) =>
        read<SaleDetailResponse>({ order: detail.sale })
      ),
    [DemoEndpoint.SALE_PROGRESS]: (pack, params) =>
      this.detail(this.findSale(pack, params['id']), ERROR.SALE.NOT_FOUND, (detail) =>
        read<SaleProgress>(detail.progress)
      ),
    [DemoEndpoint.DEPOSIT_CONFIG]: (pack) => read<DepositConfigResponse>(this.depositConfig(pack)),
    [DemoEndpoint.DEPOSIT_LIST]: (pack) =>
      read<DepositListResponse>({ deposits: [...this.deposits(pack)] }),
    [DemoEndpoint.DEPOSIT_DETAIL]: (pack, params) =>
      this.detail(
        this.deposits(pack).find((deposit) => deposit._id === params['id']),
        ERROR.DEPOSIT.NOT_FOUND,
        (deposit) => read<DepositDetailResponse>({ deposit })
      ),
    [DemoEndpoint.FIAT_OPTIONS]: (pack) => read<FiatDepositOptionsResponse>(this.fiatOptions(pack)),
    // Nobody is waiting on a sum, and no top-up stays open: the list is offered
    // afresh, so a second take needs no restart — cancelling is refused here.
    [DemoEndpoint.FIAT_WATCH]: () => read<FiatDepositWatch | null>(null),
    [DemoEndpoint.FIAT_ACTIVE]: () => read<TmaFiatDeposit | null>(null),
    [DemoEndpoint.FIAT_DETAIL]: (pack, params) =>
      this.detail(
        this.fiatDeposits(pack).find((deposit) => deposit.id === params['id']),
        ERROR.FIAT_DEPOSIT.NOT_FOUND,
        (deposit) => read<TmaFiatDeposit>(deposit)
      ),

    [DemoEndpoint.SALE_CREATE]: (pack, _, body) => this.createSale(pack, body as CreateSaleReq),
    [DemoEndpoint.DEPOSIT_CREATE]: (pack, _, body) =>
      this.createDeposit(pack, body as CreateDepositReq),
    [DemoEndpoint.FIAT_CREATE]: (pack, _, body) =>
      this.createFiatDeposit(pack, body as CreateFiatDepositReq),

    [DemoEndpoint.REFUSED]: () => refused()
  }

  /**
   * What to do with one request — always sending it on when this is not a demo
   * account, and refusing anything the route table does not know.
   */
  answer(request: DemoRequest): DemoAnswer {
    const pack = this.pack()
    if (pack === null) return NETWORK

    const match = matchDemoRoute(DEMO_ROUTES, request.method, request.path)
    if (match === null) return refused()

    return this.handlers[match.endpoint](pack, match.params, request.body)
  }

  // --- Reads ------------------------------------------------------------------

  private saleConfig(pack: TmaDemoPack): SaleConfigResponse {
    return pricedSaleConfig(pack.saleConfig, this.liveSellRate())
  }

  private depositConfig(pack: TmaDemoPack): DepositConfigResponse {
    return pricedDepositConfig(pack.depositConfig, this.liveBuyRate())
  }

  private fiatOptions(pack: TmaDemoPack): FiatDepositOptionsResponse {
    return pricedFiatOffer(pack.fiatOptions, this.liveBuyRate())
  }

  /** What this session acted out, then the pack's own. */
  private sales(pack: TmaDemoPack): readonly TmaDemoSale[] {
    return [...Object.values(this.props().sales), ...pack.sales]
  }

  private deposits(pack: TmaDemoPack): readonly TmaDeposit[] {
    return [...Object.values(this.props().deposits), ...pack.deposits]
  }

  private fiatDeposits(pack: TmaDemoPack): readonly TmaFiatDeposit[] {
    return [...Object.values(this.props().fiatDeposits), ...pack.fiatDeposits]
  }

  private findSale(pack: TmaDemoPack, id: string | undefined): TmaDemoSale | undefined {
    return this.sales(pack).find((detail) => detail.sale._id === id)
  }

  /** A record's page, or the `404` the server sends for an id it does not know. */
  private detail<T>(
    found: T | undefined,
    missing: ApiError,
    answer: (found: T) => DemoAnswer
  ): DemoAnswer {
    return found === undefined ? refused(HttpStatusCode.NotFound, missing) : answer(found)
  }

  // --- Writes, acted out --------------------------------------------------------

  private createSale(pack: TmaDemoPack, request: CreateSaleReq): DemoAnswer {
    const prop = demoSale(
      request,
      mint(),
      pack.profile.user.telegramId,
      pack.saleConfig.minOrderKopecks
    )
    this.props.update((props) => ({ ...props, sales: { ...props.sales, [prop.sale._id]: prop } }))

    return wrote<CreateSaleResponse>({
      saleId: prop.sale._id,
      publicId: prop.sale.publicId,
      status: prop.sale.status,
      transactoTerminalId: prop.sale.transactoTerminalId,
      cardId: prop.sale.cardId,
      fiatAmount: prop.sale.fiatAmount,
      bankType: prop.sale.bankType
    })
  }

  private createDeposit(pack: TmaDemoPack, request: CreateDepositReq): DemoAnswer {
    const { created, deposit } = demoDeposit(
      request.cryptoAmount,
      mint(),
      this.depositConfig(pack),
      pack.profile.user.telegramId
    )
    this.props.update((props) => ({
      ...props,
      deposits: { ...props.deposits, [deposit._id]: deposit }
    }))

    return wrote<CreateDepositResponse>(created)
  }

  private createFiatDeposit(pack: TmaDemoPack, request: CreateFiatDepositReq): DemoAnswer {
    const deposit = demoFiatDeposit(
      request.amountUah,
      mint(),
      this.fiatOptions(pack),
      pack.recipientCard
    )
    this.props.update((props) => ({
      ...props,
      fiatDeposits: { ...props.fiatDeposits, [deposit.id]: deposit }
    }))

    return wrote<TmaFiatDeposit>(deposit)
  }
}

/** A screen reading its figures: answered after {@link DemoLatencyMs.READ}. */
const read = <T>(body: T): DemoAnswer => respond(body, DemoLatencyMs.READ)

/** A button that would have started something: after {@link DemoLatencyMs.WRITE}. */
const wrote = <T>(body: T): DemoAnswer => respond(body, DemoLatencyMs.WRITE)

const respond = <T>(body: T, latencyMs: DemoLatencyMs): DemoAnswer => ({
  kind: DemoAnswerKind.RESPOND,
  body,
  latencyMs
})

/**
 * The server's own refusal, answered here.
 *
 * `ERROR.TMA_DEMO.READ_ONLY` unless said otherwise, which the dictionaries
 * translate as an ordinary "not available right now" — a promoter pressing the
 * wrong button on camera must not have the word "demo" put on screen for them.
 */
const refused = (
  status: HttpStatusCode = HttpStatusCode.Forbidden,
  error: ApiError = ERROR.TMA_DEMO.READ_ONLY
): DemoAnswer => ({ kind: DemoAnswerKind.REFUSE, status, error, latencyMs: DemoLatencyMs.WRITE })

/** Fresh ids and the moment, for one prop — ids shaped like the server's. */
const mint = (): DemoMint => ({
  id: randomChars(OBJECT_ID_ALPHABET, OBJECT_ID_LENGTH),
  publicId: randomChars(PUBLIC_ID_ALPHABET, PUBLIC_ID_LENGTH),
  now: Date.now()
})

const randomChars = (alphabet: string, length: number): string =>
  Array.from(
    crypto.getRandomValues(new Uint32Array(length)),
    (value) => alphabet[value % alphabet.length]
  ).join('')
