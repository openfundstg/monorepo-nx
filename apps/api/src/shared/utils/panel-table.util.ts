import {
  TransactoPanelCheckRow,
  TransactoPanelCurrencyId,
  TransactoPanelPayoutRow,
  TransactoPayoutStatus,
  TransactoPayoutType
} from 'src/shared/interfaces/transacto-panel.interface'

/**
 * Reading the Transacto panel's tables, which arrive as HTML and nowhere as
 * JSON.
 *
 * **This is the most fragile thing in the fiat top-up path**, and it is written
 * to fail loudly rather than quietly. Every row the panel renders carries its
 * values twice — once as rendered text, once as a `data-value` attribute — and
 * only the attributes are read: the text is localised, sometimes into a
 * different language than the one asked for, and reformatted for display.
 *
 * No HTML parser is pulled in for it. The markup is machine-generated and
 * uniform — one `<tr data-id>` per row, attributes always double-quoted — and
 * the API's runtime image ships a pruned production tree that a DOM library
 * would join for the sake of two tables. The trade is only acceptable because
 * of the second half of it: a row missing any field it must have is *not*
 * silently skipped, it is counted and reported, so a change to their markup
 * shows up as "twelve rows unreadable" in a log line instead of as a book that
 * quietly went empty.
 */

/** `<tr …>` opening tags, with their attributes. */
const ROW_TAG = /<tr\b([^>]*)>/gi

/** `<td …>` opening tags, with their attributes. */
const CELL_TAG = /<td\b([^>]*)>/gi

const attribute = (name: string): RegExp => new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i')

const DATA_ID = attribute('data-id')
const DATA_FIELD = attribute('data-field')
const DATA_VALUE = attribute('data-value')

/** `'1706.00'` → integer hryvnia and kopecks, without ever touching a float. */
const DECIMAL_AMOUNT = /^(\d+)(?:[.,](\d{1,2}))?$/

/** Digits and nothing else. `Number('')` is `0`, which is not a payout id. */
const INTEGER = /^\d+$/

/** `'2026-09-03 12:30:33'`, the only date shape these tables use. */
const PANEL_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/

/**
 * The panel renders its tables in UTC+3 while its JSON answers in UTC — the
 * same host, the same response, two clocks. Verified by comparing a check row's
 * `created_at` against the `Date` header of the very response that carried it.
 */
const PANEL_TABLE_UTC_OFFSET = '+03:00'

const ENTITIES: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#039;': "'",
  '&#39;': "'",
  '&nbsp;': ' '
}

const decodeEntities = (value: string): string =>
  value.replace(
    /&(?:amp|lt|gt|quot|nbsp|#0?39);/gi,
    (entity) => ENTITIES[entity.toLowerCase()] ?? entity
  )

/**
 * A whole-number field, or `null` when it is absent, empty or not a number.
 *
 * `Number` is not usable directly here: it reads `''` as `0` and `' 5 '` as
 * `5`, so an emptied cell would arrive as a perfectly plausible id.
 */
const toInteger = (value: string | undefined): number | null =>
  value !== undefined && INTEGER.test(value) ? Number(value) : null

/** One row's `data-id` and its cells, keyed by `data-field`. */
export interface PanelTableRow {
  readonly id: number
  readonly fields: Readonly<Record<string, string>>
}

/** What one table yielded: the rows that read cleanly, and how many did not. */
export interface PanelTableParse<T> {
  readonly rows: readonly T[]
  /**
   * Rows that looked like rows and could not be read.
   *
   * The signal that their markup moved. Anything above zero is worth an error
   * line even when `rows` is not empty — a table half of which no longer parses
   * is a table whose next release parses none of it.
   */
  readonly unreadable: number
}

/**
 * Every `<tr>` carrying a `data-id`, with its cells.
 *
 * The header row has no `data-id`, which is what excludes it — cheaper and
 * more robust than trying to tell `<thead>` from `<tbody>` in a fragment that
 * often has neither.
 */
export const parsePanelTableRows = (html: string): PanelTableRow[] => {
  const source = String(html ?? '')
  const openings = [...source.matchAll(ROW_TAG)]

  return openings.flatMap((opening, index) => {
    const id = DATA_ID.exec(opening[1])
    if (id === null) return []

    const numericId = Number(id[1])
    if (!Number.isInteger(numericId)) return []

    const start = opening.index + opening[0].length
    const end = index + 1 < openings.length ? openings[index + 1].index : source.length

    return [{ id: numericId, fields: parseCells(source.slice(start, end)) }]
  })
}

const parseCells = (rowHtml: string): Record<string, string> =>
  [...rowHtml.matchAll(CELL_TAG)].reduce<Record<string, string>>((fields, cell) => {
    const field = DATA_FIELD.exec(cell[1])
    const value = DATA_VALUE.exec(cell[1])
    if (field === null || value === null) return fields

    return { ...fields, [field[1]]: decodeEntities(value[1]).trim() }
  }, {})

/**
 * UAH kopecks from a panel amount like `'1706.00'`.
 *
 * Integer arithmetic on the digits rather than `Number(x) * 100`, which is not
 * exact for every two-decimal value and would put a kopeck of somebody's
 * transfer in the wrong place. `null` when the string is not an amount at all.
 */
export const panelAmountToKopecks = (amount: string): number | null => {
  const matched = DECIMAL_AMOUNT.exec(String(amount ?? '').trim())
  if (matched === null) return null

  const [, whole, fraction = ''] = matched

  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
}

/** A `Date` from a panel table timestamp, read as UTC+3. `null` if malformed. */
export const panelTimestampToDate = (timestamp: string): Date | null => {
  const matched = PANEL_TIMESTAMP.exec(String(timestamp ?? '').trim())
  if (matched === null) return null

  const [, year, month, day, hours, minutes, seconds] = matched
  const parsed = new Date(
    `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${PANEL_TABLE_UTC_OFFSET}`
  )

  return Number.isNaN(parsed.getTime()) ? null : parsed
}

const isPayoutType = (value: string): value is TransactoPayoutType =>
  Object.values(TransactoPayoutType).includes(value as TransactoPayoutType)

const isPayoutStatus = (value: string): value is TransactoPayoutStatus =>
  Object.values(TransactoPayoutStatus).includes(value as TransactoPayoutStatus)

/** Numeric enums carry their reverse mapping too; only the numbers are ids. */
const CURRENCY_IDS: readonly number[] = Object.values(TransactoPanelCurrencyId).filter(
  (value): value is number => typeof value === 'number'
)

/**
 * The payouts table — new, active or history, which all render the same shape.
 *
 * A currency this codebase has never seen is not "unreadable": the panel serves
 * five and the book is filtered down to hryvnia anyway, so an unknown id is a
 * row to ignore, not a sign their markup broke. An unknown *status* or *type*
 * is the opposite and counts against the parse.
 */
export const parsePanelPayoutRows = (html: string): PanelTableParse<TransactoPanelPayoutRow> => {
  const parsed = parsePanelTableRows(html)
    // A currency the panel serves and we do not is dropped before validation,
    // so it never reaches the unreadable count.
    .filter(({ fields }) => {
      const currencyId = toInteger(fields['currency_id'])
      return currencyId === null || CURRENCY_IDS.includes(currencyId)
    })
    .map(({ id, fields }) => {
      const currencyId = toInteger(fields['currency_id'])

      if (
        currencyId === null ||
        fields['created_at'] === undefined ||
        fields['type'] === undefined ||
        fields['cred'] === undefined ||
        fields['amount'] === undefined ||
        fields['status'] === undefined ||
        !isPayoutType(fields['type']) ||
        !isPayoutStatus(fields['status']) ||
        panelAmountToKopecks(fields['amount']) === null
      )
        return null

      const row: TransactoPanelPayoutRow = {
        id,
        created_at: fields['created_at'],
        type: fields['type'],
        cred: fields['cred'],
        recipient_name: fields['recipient_name'] ?? '',
        amount: fields['amount'],
        status: fields['status'],
        currency_id: currencyId,
        receiver_bank: fields['receiver_bank'] ?? ''
      }

      return row
    })

  return {
    rows: parsed.filter((row): row is TransactoPanelPayoutRow => row !== null),
    unreadable: parsed.filter((row) => row === null).length
  }
}

/**
 * The checks table — receipts already attached to payouts.
 *
 * This is where coverage comes from, so a row that cannot be read is a receipt
 * whose hryvnia would go uncounted. Hence the same loud-failure count, and
 * hence `payout_id` and `amount` being required rather than defaulted.
 */
export const parsePanelCheckRows = (html: string): PanelTableParse<TransactoPanelCheckRow> => {
  const parsed = parsePanelTableRows(html).map(({ id, fields }) => {
    const payoutId = toInteger(fields['payout_id'])

    if (
      payoutId === null ||
      fields['created_at'] === undefined ||
      fields['amount'] === undefined ||
      panelAmountToKopecks(fields['amount']) === null
    )
      return null

    const row: TransactoPanelCheckRow = {
      id,
      created_at: fields['created_at'],
      date: fields['date'] ?? '',
      payout_id: payoutId,
      check_url: fields['check_url'] ?? '',
      amount: fields['amount'],
      receiving_bank: fields['receiving_bank'] ?? '',
      sender: fields['sender'] ?? '',
      recipient: fields['recipient'] ?? ''
    }

    return row
  })

  return {
    rows: parsed.filter((row): row is TransactoPanelCheckRow => row !== null),
    unreadable: parsed.filter((row) => row === null).length
  }
}
