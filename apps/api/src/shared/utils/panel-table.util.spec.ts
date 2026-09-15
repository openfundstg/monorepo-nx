import {
  panelAmountToKopecks,
  panelTimestampToDate,
  parsePanelCheckRows,
  parsePanelPayoutRows,
  parsePanelTableRows
} from './panel-table.util'
import {
  TransactoPanelCurrencyId,
  TransactoPayoutStatus,
  TransactoPayoutType
} from 'src/shared/interfaces/transacto-panel.interface'

/** A row copied from a live `?ajax_active_payouts` fragment, action cells and all. */
const activeRow = (overrides: Partial<Record<string, string>> = {}) => {
  const cell = (field: string, value: string, extra = '') =>
    `<td ${extra}data-field="${field}" data-title="x" data-value="${value}">rendered</td>`

  const fields: Record<string, string> = {
    created_at: '2026-09-03 12:30:33',
    type: TransactoPayoutType.CARD,
    cred: '4400000000005551',
    recipient_name: '',
    amount: '600.00',
    status: TransactoPayoutStatus.PENDING,
    currency_id: '5',
    receiver_bank: '',
    ...overrides
  }

  return `
<tr data-id="100990" id="p2p_payouts_tr_100990" class="p2p_payouts_tr">
<td data-field="id" data-title="ID" class="id_td">100990</td>
${cell('created_at', fields['created_at'])}
${cell('type', fields['type'])}
${cell('cred', fields['cred'], 'align="right" ')}
${cell('recipient_name', fields['recipient_name'])}
${cell('amount', fields['amount'], 'align="right" ')}
${cell('status', fields['status'])}
${cell('currency_id', fields['currency_id'])}
${cell('receiver_bank', fields['receiver_bank'])}
	<td data-field="action" data-title="Звільнити"><a data-id="100990" class="free_payout_button" href="/panels/payout_actions?release_payout=1&amp;id=100990">Звільнити</a></td>
	<td data-field="action" data-title="Завантажити чек"><a data-id="100990" class="payout_add_check_button" href="/panels/payout_actions?add_check=1&amp;id=100990">Завантажити чек</a></td>
</tr>`
}

const TABLE_HEADER = `
<table class='data_table table table-striped' id='data_table_p2p_payouts' width='100%'>
<thead class="thead-lightblue">
<tr class="table_header">
<th>ID</th>	<th data-field="created_at">Створено</th>
	<th data-field="status">Статус</th>
</tr></thead>`

const checkRow = `
<tr data-id="32010" id="p2p_checks_tr_32010" class="p2p_checks_tr">
<td data-field="created_at" data-title="Дата/час" data-value="2026-09-03 13:14:13">03.09.2026 13:14:13</td>
<td data-field="date" data-title="Дата чека" data-value="2026-09-03 13:10:00">03.09.2026 13:10:00</td>
<td align="right" data-field="payout_id" data-title="Виплата" data-value="100990">100990</td>
<td data-field="check_url" data-title="URL" data-value="https://minio.c2c.best/my-bucket/check_1788430375.pdf">https://minio.c2c.best/my-bucket/check_1788430375.pdf</td>
<td align="right" data-field="amount" data-title="Сума" data-value="600.00">600</td>
<td data-field="receiving_bank" data-title="Банк отримувача" data-value="ПУМБ">ПУМБ</td>
<td data-field="sender" data-title="Відправник" data-value="">-</td>
<td data-field="recipient" data-title="Отримувач" data-value="">-</td>
</tr>`

describe('parsePanelTableRows', () => {
  /**
   * The header row carries no `data-id`, which is what excludes it — the
   * fragments often arrive without a `<tbody>` to tell it apart by.
   */
  it('reads the data rows and leaves the header alone', () => {
    const rows = parsePanelTableRows(`${TABLE_HEADER}${activeRow()}</table>`)

    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(100990)
  })

  /** Action cells nest an `<a data-id>` of their own; a row must not split on it. */
  it('does not mistake a link inside a cell for another row', () => {
    expect(parsePanelTableRows(activeRow())).toHaveLength(1)
  })

  it('decodes the entities the panel escapes into attributes', () => {
    const rows = parsePanelTableRows(
      '<tr data-id="1"><td data-field="receiving_bank" data-value="R&amp;B Bank">x</td></tr>'
    )

    expect(rows[0].fields['receiving_bank']).toBe('R&B Bank')
  })
})

describe('parsePanelPayoutRows', () => {
  it('reads a live row exactly as the panel states it', () => {
    const { rows, unreadable } = parsePanelPayoutRows(`${TABLE_HEADER}${activeRow()}</table>`)

    expect(unreadable).toBe(0)
    expect(rows[0]).toEqual({
      id: 100990,
      created_at: '2026-09-03 12:30:33',
      type: TransactoPayoutType.CARD,
      cred: '4400000000005551',
      recipient_name: '',
      amount: '600.00',
      status: TransactoPayoutStatus.PENDING,
      currency_id: 5,
      receiver_bank: ''
    })
  })

  /**
   * The point of the count. A markup change must not read as an empty book —
   * "nothing to take" and "we can no longer read the page" are opposite facts,
   * and only one of them is worth waking somebody for.
   */
  it('counts a row it cannot read rather than dropping it silently', () => {
    const { rows, unreadable } = parsePanelPayoutRows(activeRow({ status: 'RENAMED_UPSTREAM' }))

    expect(rows).toEqual([])
    expect(unreadable).toBe(1)
  })

  it('counts a row whose amount stopped being an amount', () => {
    expect(parsePanelPayoutRows(activeRow({ amount: '1 706,00 ₴' })).unreadable).toBe(1)
  })

  /** Filtering to hryvnia is the caller's decision, not the parser's. */
  it('reads a currency it does not settle in, and lets the caller drop it', () => {
    const { rows, unreadable } = parsePanelPayoutRows(activeRow({ currency_id: '1' }))

    expect(rows[0].currency_id).toBe(TransactoPanelCurrencyId.RUB)
    expect(unreadable).toBe(0)
  })

  /**
   * A currency id the panel has never served is a row to ignore, not a sign
   * their markup broke — the two must not share a counter.
   */
  it('ignores an unknown currency without calling the row broken', () => {
    expect(parsePanelPayoutRows(activeRow({ currency_id: '3' }))).toEqual({
      rows: [],
      unreadable: 0
    })
  })
})

describe('parsePanelCheckRows', () => {
  it('reads a receipt row, which is where coverage is counted from', () => {
    const { rows, unreadable } = parsePanelCheckRows(checkRow)

    expect(unreadable).toBe(0)
    expect(rows[0]).toMatchObject({
      id: 32010,
      payout_id: 100990,
      amount: '600.00',
      receiving_bank: 'ПУМБ',
      check_url: 'https://minio.c2c.best/my-bucket/check_1788430375.pdf'
    })
  })

  it('counts a receipt row with no payout to attribute it to', () => {
    const orphan = checkRow.replace('data-value="100990">100990', 'data-value="">-')

    expect(parsePanelCheckRows(orphan)).toEqual({ rows: [], unreadable: 1 })
  })
})

describe('panelAmountToKopecks', () => {
  /**
   * Integer arithmetic on the digits, not `Number(x) * 100`: that is inexact
   * for some two-decimal values, and the error lands in somebody's transfer.
   */
  it.each([
    ['600.00', 60_000],
    ['1706.00', 170_600],
    ['0.29', 29],
    ['600', 60_000],
    ['600.5', 60_050]
  ])('reads %s as %i kopecks', (amount, expected) => {
    expect(panelAmountToKopecks(amount)).toBe(expected)
  })

  it.each(['', '-600.00', '1 706,00 ₴', 'six hundred', '600.000'])(
    'refuses %p rather than guessing',
    (amount) => {
      expect(panelAmountToKopecks(amount)).toBeNull()
    }
  )
})

describe('panelTimestampToDate', () => {
  /**
   * The tables are UTC+3 while the JSON on the same host is UTC. A row stamped
   * 12:30:33 was created at 09:30:33 UTC, and reading it as local time would
   * put every deadline three hours out.
   */
  it('reads a table timestamp as UTC+3', () => {
    expect(panelTimestampToDate('2026-09-03 12:30:33')?.toISOString()).toBe(
      '2026-09-03T09:30:33.000Z'
    )
  })

  it.each(['', '03.09.2026 12:30:33', '2026-09-03', 'yesterday'])(
    'refuses %p rather than inventing a moment',
    (value) => {
      expect(panelTimestampToDate(value)).toBeNull()
    }
  )
})
