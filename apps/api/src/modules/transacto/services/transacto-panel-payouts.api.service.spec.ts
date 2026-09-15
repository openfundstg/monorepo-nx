import { Logger } from '@nestjs/common'
import { TransactoPanelPayoutsApiService } from './transacto-panel-payouts.api.service'
import { TransactoPayoutStatus } from 'src/shared/interfaces/transacto-panel.interface'
import type { HttpService } from '@nestjs/axios'
import type { TransactoPanelSessionApiService } from './transacto-panel-session.api.service'

const COOKIE = 'remember_token=t; PHPSESSID=s'
const CSRF = 'c'.repeat(64)
const PAYOUT_ID = 100990

const newPayoutsTable = `
<table id='data_table_p2p_payouts'>
<thead><tr class="table_header"><th>ID</th></tr></thead>
<tr data-id="100990" class="p2p_payouts_tr">
<td data-field="id" class="id_td">100990</td>
<td data-field="created_at" data-value="2026-09-03 12:30:33">x</td>
<td data-field="type" data-value="CARD">Карта</td>
<td align="right" data-field="cred" data-value="4400000000005551">x</td>
<td data-field="recipient_name" data-value="">-</td>
<td align="right" data-field="amount" data-value="600.00">600</td>
<td data-field="status" data-value="NEW">Создана</td>
<td data-field="currency_id" data-value="5">UAH</td>
<td data-field="receiver_bank" data-value="">-</td>
</tr></table>`

describe('TransactoPanelPayoutsApiService', () => {
  let get: jest.Mock
  let post: jest.Mock
  let service: TransactoPanelPayoutsApiService

  beforeEach(() => {
    get = jest.fn()
    post = jest.fn().mockResolvedValue({ status: 200, headers: {}, data: { status: 'ok' } })

    // The session's own behaviour has its own spec; here it is reduced to what
    // this service depends on — a cookie to present and a token to sign with.
    const session = {
      run: <T>(call: (cookie: string) => Promise<T>) => call(COOKIE),
      getCsrfToken: async () => CSRF
    } as unknown as TransactoPanelSessionApiService

    service = new TransactoPanelPayoutsApiService(
      { axiosRef: { get, post } } as unknown as HttpService,
      session
    )
  })

  describe('reading the book', () => {
    it('parses the open payouts out of the fragment', async () => {
      get.mockResolvedValue({ status: 200, headers: {}, data: newPayoutsTable })

      const { rows, unreadable } = await service.getNewPayouts()

      expect(unreadable).toBe(0)
      expect(rows[0]).toMatchObject({ id: PAYOUT_ID, status: TransactoPayoutStatus.NEW })
    })

    /** A few bytes instead of eleven kilobytes, so polling is nearly free. */
    it('reads the count off its own endpoint', async () => {
      get.mockResolvedValue({ status: 200, headers: {}, data: { status: 'ok', count: 3 } })

      await expect(service.getOpenPayoutsCount()).resolves.toBe(3)
      expect(get.mock.calls[0][0]).toBe('/panels/payouts?payouts_count')
    })

    it('reads a countless body as an empty book rather than as NaN', async () => {
      get.mockResolvedValue({ status: 200, headers: {}, data: { status: 'ok' } })

      await expect(service.getOpenPayoutsCount()).resolves.toBe(0)
    })

    /** The history tab needs both flags; its own UI sends them together. */
    it('asks history for the table, not the page', async () => {
      get.mockResolvedValue({ status: 200, headers: {}, data: '' })

      await service.getPayoutHistory()

      expect(get.mock.calls[0][0]).toBe('/panels/payouts?ajax_history=1&get_table_ajax=1')
    })

    /**
     * The loud half of the bargain struck by parsing HTML by hand: a row that
     * stopped parsing has to be visible, because by the time a caller sees the
     * rows it is indistinguishable from a row that never existed.
     */
    it('logs an error when a row stops being readable', async () => {
      const errors: string[] = []
      jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation((message: unknown) => void errors.push(String(message)))
      get.mockResolvedValue({
        status: 200,
        headers: {},
        data: newPayoutsTable.replace('data-value="NEW"', 'data-value="RENAMED"')
      })

      const { rows } = await service.getNewPayouts()

      expect(rows).toEqual([])
      expect(errors.join('\n')).toContain('1 row(s) this build cannot read')
      jest.restoreAllMocks()
    })
  })

  describe('taking and releasing', () => {
    it('assigns by posting the signed form to the payout', async () => {
      await service.assignPayout(PAYOUT_ID)

      const [url, body, config] = post.mock.calls[0]
      expect(url).toBe(`/panels/payout_actions?assign_trader=1&id=${PAYOUT_ID}`)
      expect(Object.fromEntries(new URLSearchParams(body))).toEqual({ csrf_token: CSRF })
      expect(config.headers['Content-Type']).toContain('application/x-www-form-urlencoded')
      expect(config.headers.Cookie).toBe(COOKIE)
    })

    it('releases through the panel’s own action, not by deleting anything', async () => {
      await service.releasePayout(PAYOUT_ID)

      expect(post.mock.calls[0][0]).toBe(
        `/panels/payout_actions?release_payout=1&id=${PAYOUT_ID}`
      )
    })
  })

  describe('receipts', () => {
    it('uploads the file for recognition only, writing nothing', async () => {
      post.mockResolvedValue({
        status: 200,
        headers: {},
        data: { status: 'parsing', job_id: 2242, payoutId: PAYOUT_ID }
      })

      await service.uploadCheck(PAYOUT_ID, {
        buffer: Buffer.from('%PDF-1.4'),
        fileName: 'receipt.pdf',
        mimeType: 'application/pdf'
      })

      const [url, form] = post.mock.calls[0]
      expect(url).toBe(`/panels/payout_actions?upload_check=1&id=${PAYOUT_ID}`)
      expect(form).toBeInstanceOf(FormData)
      expect(form.get('preview_only')).toBe('1')
      expect(form.get('csrf_token')).toBe(CSRF)
      expect((form.get('file') as File).name).toBe('receipt.pdf')
    })

    it('polls one job by its id', async () => {
      await service.getCheckParseStatus(PAYOUT_ID, 2242)

      const [url, body] = post.mock.calls[0]
      expect(url).toBe(`/panels/payout_actions?parse_check_status=1&id=${PAYOUT_ID}`)
      expect(Object.fromEntries(new URLSearchParams(body))).toEqual({
        job_id: '2242',
        id: String(PAYOUT_ID),
        csrf_token: CSRF
      })
    })

    /**
     * The rule with money behind it. `force_accept` pushes a receipt past
     * Transacto's own recognition warning, and using it would mean overruling
     * the counterparty's anti-fraud check on our guess about somebody else's
     * transfer.
     */
    it('never asks the panel to accept a receipt against its own warning', async () => {
      await service.confirmCheck(PAYOUT_ID)

      const [url, body] = post.mock.calls[0]
      expect(url).toBe(`/panels/payout_actions?confirm_check=1&id=${PAYOUT_ID}`)
      expect(Object.fromEntries(new URLSearchParams(body))).toMatchObject({
        force_accept: 'false'
      })
    })
  })
})
