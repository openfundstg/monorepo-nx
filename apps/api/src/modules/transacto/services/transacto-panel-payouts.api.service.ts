import { Injectable, Logger } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import type { AxiosResponse } from 'axios'
import {
  TransactoPanelCheckResponse,
  TransactoPanelCheckRow,
  TransactoPanelPayoutActionResponse,
  TransactoPanelPayoutRow,
  TransactoPanelPayoutsCountResponse
} from 'src/shared/interfaces/transacto-panel.interface'
import { TransactoPanelSessionApiService } from 'src/modules/transacto/services/transacto-panel-session.api.service'
import type { PanelReceiptFile } from 'src/modules/transacto/interfaces'
import { parsePanelCheckRows, parsePanelPayoutRows, type PanelTableParse } from 'src/shared/utils'

const PAYOUTS_PATH = '/panels/payouts'
const ACTIONS_PATH = '/panels/payout_actions'

/**
 * The query flags the payouts page answers to, exactly as its own UI sends
 * them — `ajax_new_payouts` with no value, `ajax_history` with one. The
 * inconsistency is theirs and is copied rather than tidied, because what the
 * page branches on has not been read.
 */
const PanelPayoutsQuery = {
  COUNT: 'payouts_count',
  NEW: 'ajax_new_payouts',
  ACTIVE: 'ajax_active_payouts',
  HISTORY: 'ajax_history=1&get_table_ajax=1',
  CHECKS: 'ajax_checks'
} as const
type PanelPayoutsQuery = (typeof PanelPayoutsQuery)[keyof typeof PanelPayoutsQuery]

/** The action flags on `/panels/payout_actions`, one per query parameter. */
const PanelPayoutAction = {
  ASSIGN: 'assign_trader',
  RELEASE: 'release_payout',
  UPLOAD_CHECK: 'upload_check',
  PARSE_STATUS: 'parse_check_status',
  PARSE_ACTIVE: 'parse_check_active',
  CONFIRM_CHECK: 'confirm_check'
} as const
type PanelPayoutAction = (typeof PanelPayoutAction)[keyof typeof PanelPayoutAction]

/**
 * Everything the fiat top-up path says to the Transacto panel — and nothing it
 * decides.
 *
 * Transport only, by the layering rule, and the line is worth stating because
 * it is tempting to cross here: this service will happily assign a payout it
 * has no business assigning. Whether a payout should be taken, whether a
 * receipt covers it, and what any of it means for a user's balance are
 * decisions for the domain service above.
 *
 * Two shapes come back and they are not interchangeable. The tables are HTML,
 * parsed by {@link parsePanelPayoutRows} and reported with a count of rows that
 * could not be read; the actions are JSON, whose success values differ per
 * endpoint (`'ok'` here, `'success'` on keepalive, `'preview'` mid-recognition)
 * and are therefore returned unjudged.
 */
@Injectable()
export class TransactoPanelPayoutsApiService {
  private readonly logger = new Logger(TransactoPanelPayoutsApiService.name)

  constructor(
    private readonly httpService: HttpService,
    private readonly session: TransactoPanelSessionApiService
  ) {}

  /**
   * How many payouts are in the open book.
   *
   * The cheap half of polling: a few bytes of JSON against eleven kilobytes of
   * table, so the book is only re-read when this number moves.
   */
  async getOpenPayoutsCount(): Promise<number> {
    const response = await this.getJson<TransactoPanelPayoutsCountResponse>(
      `${PAYOUTS_PATH}?${PanelPayoutsQuery.COUNT}`
    )

    const count = response.data?.count

    return typeof count === 'number' && Number.isFinite(count) ? count : 0
  }

  /** The open book — every payout nobody has taken yet, in every currency. */
  async getNewPayouts(): Promise<PanelTableParse<TransactoPanelPayoutRow>> {
    return this.getPayoutTable(PanelPayoutsQuery.NEW)
  }

  /** Payouts assigned to this trader and not yet closed. */
  async getActivePayouts(): Promise<PanelTableParse<TransactoPanelPayoutRow>> {
    return this.getPayoutTable(PanelPayoutsQuery.ACTIVE)
  }

  /**
   * Closed payouts, newest first.
   *
   * The only place a payout states that it was executed: a row that leaves the
   * active table has been completed, released or refused, and only this table
   * says which.
   */
  async getPayoutHistory(): Promise<PanelTableParse<TransactoPanelPayoutRow>> {
    return this.getPayoutTable(PanelPayoutsQuery.HISTORY)
  }

  /**
   * Receipts already attached to payouts.
   *
   * Coverage is counted from here rather than from what we believe we uploaded:
   * each row names its payout and the amount Transacto recognised, which is the
   * figure the counterparty will settle against.
   */
  async getChecks(): Promise<PanelTableParse<TransactoPanelCheckRow>> {
    const response = await this.getHtml(`${PAYOUTS_PATH}?${PanelPayoutsQuery.CHECKS}`)
    const parsed = parsePanelCheckRows(response.data)
    this.warnIfUnreadable(PanelPayoutsQuery.CHECKS, parsed.unreadable)

    return parsed
  }

  /** Takes an unassigned payout. Until this returns `ok`, it is anybody's. */
  async assignPayout(payoutId: number): Promise<TransactoPanelPayoutActionResponse> {
    return this.act(PanelPayoutAction.ASSIGN, payoutId)
  }

  /** Hands a payout back to the open book. */
  async releasePayout(payoutId: number): Promise<TransactoPanelPayoutActionResponse> {
    return this.act(PanelPayoutAction.RELEASE, payoutId)
  }

  /**
   * Sends a receipt for recognition. Nothing is attached by this call.
   *
   * `preview_only=1` is what makes it a dry run: the panel recognises the file
   * and parks the result against the payout, and only {@link confirmCheck}
   * writes. The reply is `parsing` with a `job_id` to poll.
   */
  async uploadCheck(
    payoutId: number,
    file: PanelReceiptFile
  ): Promise<TransactoPanelCheckResponse> {
    const response = await this.session.run<TransactoPanelCheckResponse>(async (cookie) => {
      const csrfToken = await this.session.getCsrfToken()

      const form = new FormData()
      form.append(
        'file',
        new Blob([new Uint8Array(file.buffer)], { type: file.mimeType }),
        file.fileName
      )
      form.append('csrf_token', csrfToken)
      form.append('preview_only', '1')

      return this.httpService.axiosRef.post(
        this.actionUrl(PanelPayoutAction.UPLOAD_CHECK, payoutId),
        form,
        {
          headers: { Cookie: cookie, ...AJAX_HEADERS, Accept: 'application/json' }
        }
      )
    })

    return response.data
  }

  /** Polls one recognition job. Answers `parsing` until it does not. */
  async getCheckParseStatus(payoutId: number, jobId: number): Promise<TransactoPanelCheckResponse> {
    return this.postCheckAction(PanelPayoutAction.PARSE_STATUS, payoutId, {
      job_id: String(jobId),
      id: String(payoutId)
    })
  }

  /**
   * Whether a recognition job is running for this payout — `idle` when none is.
   *
   * How a restart finds a job it was already waiting on, rather than leaving a
   * receipt in limbo with its answer sitting unread upstream.
   */
  async getActiveCheckParse(payoutId: number): Promise<TransactoPanelCheckResponse> {
    return this.postCheckAction(PanelPayoutAction.PARSE_ACTIVE, payoutId, {
      id: String(payoutId)
    })
  }

  /**
   * Attaches the recognised receipt to the payout. **This is the write.**
   *
   * `force_accept` is always `false`. The panel offers it to push a receipt
   * through against its own recognition warning, and using it would mean
   * overriding the counterparty's anti-fraud check on our guess about somebody
   * else's money.
   *
   * It carries no job id: the panel confirms whatever it has parked against the
   * payout, which is why two receipts may never be in flight for one at once.
   */
  async confirmCheck(payoutId: number): Promise<TransactoPanelCheckResponse> {
    return this.postCheckAction(PanelPayoutAction.CONFIRM_CHECK, payoutId, {
      id: String(payoutId),
      force_accept: 'false'
    })
  }

  private async getPayoutTable(
    query: PanelPayoutsQuery
  ): Promise<PanelTableParse<TransactoPanelPayoutRow>> {
    const response = await this.getHtml(`${PAYOUTS_PATH}?${query}`)
    const parsed = parsePanelPayoutRows(response.data)
    this.warnIfUnreadable(query, parsed.unreadable)

    return parsed
  }

  /**
   * A row that looked like a row and could not be read is the signal their
   * markup moved, and it is only visible here — by the time a caller sees the
   * rows, an unreadable one is indistinguishable from one that never existed.
   */
  private warnIfUnreadable(query: string, unreadable: number): void {
    if (unreadable === 0) return

    this.logger.error(
      `Panel table ${query} returned ${unreadable} row(s) this build cannot read — ` +
        'their markup or their vocabulary has changed'
    )
  }

  private getHtml(url: string): Promise<AxiosResponse<string>> {
    return this.session.run<string>((cookie) =>
      this.httpService.axiosRef.get(url, {
        headers: { Cookie: cookie, ...AJAX_HEADERS, Accept: 'text/html, */*; q=0.01' }
      })
    )
  }

  private getJson<T>(url: string): Promise<AxiosResponse<T>> {
    return this.session.run<T>((cookie) =>
      this.httpService.axiosRef.get(url, {
        headers: { Cookie: cookie, ...AJAX_HEADERS, Accept: 'application/json' }
      })
    )
  }

  private async act(
    action: PanelPayoutAction,
    payoutId: number
  ): Promise<TransactoPanelPayoutActionResponse> {
    const response = await this.postForm<TransactoPanelPayoutActionResponse>(action, payoutId, {})

    this.logger.log(`Panel ${action} on payout ${payoutId}: ${response.data?.status}`)

    return response.data
  }

  private async postCheckAction(
    action: PanelPayoutAction,
    payoutId: number,
    fields: Record<string, string>
  ): Promise<TransactoPanelCheckResponse> {
    const response = await this.postForm<TransactoPanelCheckResponse>(action, payoutId, fields)

    return response.data
  }

  /**
   * Every panel write is an urlencoded form carrying the CSRF token, addressed
   * by a query flag and the payout id.
   */
  private async postForm<T>(
    action: PanelPayoutAction,
    payoutId: number,
    fields: Record<string, string>
  ): Promise<AxiosResponse<T>> {
    return this.session.run<T>(async (cookie) => {
      const csrfToken = await this.session.getCsrfToken()
      const body = new URLSearchParams({ ...fields, csrf_token: csrfToken }).toString()

      return this.httpService.axiosRef.post(this.actionUrl(action, payoutId), body, {
        headers: {
          Cookie: cookie,
          ...AJAX_HEADERS,
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          Accept: 'application/json, text/javascript, */*; q=0.01'
        }
      })
    })
  }

  private actionUrl(action: PanelPayoutAction, payoutId: number): string {
    return `${ACTIONS_PATH}?${action}=1&id=${payoutId}`
  }
}

/**
 * Sent on every call, as the panel's own UI does.
 *
 * Whether it branches on this header has not been established — so it is sent
 * rather than dropped, on the principle that a request which differs from the
 * captured one differs in a way nobody has tested.
 */
const AJAX_HEADERS = { 'X-Requested-With': 'XMLHttpRequest' } as const
