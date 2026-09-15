import {
  TransactoPanelCurrencyId,
  TransactoPayoutStatus,
  TransactoPayoutType,
  type TransactoPanelCheckRow,
  type TransactoPanelPayoutRow
} from 'src/shared/interfaces/transacto-panel.interface'

/**
 * A row of the panel's payouts table, as three specs need one.
 *
 * The book, the reservation path and the reconciler each had their own builder
 * for the same nine fields — and the fields are the shape of somebody else's
 * HTML, so a spec quietly describing a row the panel never sends is a test that
 * passes for the wrong reason.
 *
 * The defaults are the ordinary case: an open UAH card payout for ₴600. Note
 * `amount` is a decimal string and not kopecks, because that is how the panel
 * states it.
 */
export const panelPayoutRow = (
  overrides: Partial<TransactoPanelPayoutRow> = {}
): TransactoPanelPayoutRow => ({
  id: 100_990,
  created_at: '2026-09-03 12:30:33',
  type: TransactoPayoutType.CARD,
  cred: '4400000000005551',
  recipient_name: '',
  amount: '600.00',
  status: TransactoPayoutStatus.NEW,
  currency_id: TransactoPanelCurrencyId.UAH,
  receiver_bank: '',
  ...overrides
})

/**
 * One row of the panel's checks table — a receipt Transacto has attached to a
 * payout, and the amount it recognised.
 *
 * The sum over one `payout_id` is what the counterparty considers received, so
 * this is the fixture for anything that decides whether a payout is empty.
 */
export const panelCheckRow = (
  overrides: Partial<TransactoPanelCheckRow> = {}
): TransactoPanelCheckRow => ({
  id: 55_120,
  created_at: '2026-09-07 19:31:04',
  date: '2026-09-07 19:29:00',
  payout_id: 100_990,
  check_url: 'https://storage.transacto.us/checks/55120.jpg',
  amount: '600.00',
  receiving_bank: 'ПУМБ',
  sender: '',
  recipient: '',
  ...overrides
})
