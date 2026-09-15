import { ExtensionDashboardService } from './extension-dashboard.service'
import { AlertType, AlertStatus } from 'src/modules/repositories/alerts-db/schemas'
import type { AlertsService } from 'src/modules/alerts/services/alerts.service'
import type { TerminalDbService } from 'src/modules/repositories/terminal-db/services'
import type { OrderDbService } from 'src/modules/repositories/order-db/services'
import type { TerminalHistoryDbService } from 'src/modules/repositories/terminal-history-db/services'
import type { SafeBoxDbService } from 'src/modules/repositories/safe-box-db/services'
import type { TerminalUrlResolverService } from 'src/modules/terminal'
import type { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'

const TRADER_ID = 592
const ALERT_ID = '6a8ddf4b6e74973f75ffe446'
const TERMINAL_ID = 27_339
const CARD_ID = 100
const JAR_URL = 'https://send.monobank.ua/jar/Z38SL69F'

/** Scraped just now. */
const SCRAPED_BALANCE = 685_500
/** What matched orders last accounted for — deliberately older and lower. */
const BASELINE = 400_000

/** As `getUnreadAlerts` returns it — metadata nested, exactly as stored. */
const storedAlert = () => ({
  _id: { toString: () => ALERT_ID },
  traderId: TRADER_ID,
  terminalId: 27_339,
  type: AlertType.UNRECOGNIZED_DEPOSIT,
  amount: 251_500,
  status: AlertStatus.PENDING,
  isRead: false,
  metadata: { amount: 251_500, totalDelta: 251_500 },
})

const storedTerminal = () => ({
  traderId: TRADER_ID,
  terminalId: TERMINAL_ID,
  cardId: CARD_ID,
  terminalName: 'TMA-3PXBLYM0',
  cred3: JAR_URL,
  enabled: true,
})

/**
 * The manual-sync bug. `getDashboard` read the scraped balance and then
 * overwrote it with the baseline unconditionally.
 *
 * The two are not the same number: the baseline is the fraud detector's
 * reference point — money already accounted for by matched orders — and it only
 * moves when orders match. So a manual sync appeared to work, because the fresh
 * figure went out over `TERMINAL_BALANCE_UPDATED` and the UI took it, and then
 * reverted as soon as the extension was reopened and re-read this endpoint.
 */
describe('ExtensionDashboardService — which balance the dashboard reports', () => {
  const build = (currentState: { current: number; goal?: number } | null, baseline: number | null) => {
    const service = new ExtensionDashboardService(
      { getUnreadAlerts: jest.fn().mockResolvedValue([]) } as unknown as AlertsService,
      { find: jest.fn().mockResolvedValue([storedTerminal()]) } as unknown as TerminalDbService,
      {
        getCurrentState: jest.fn().mockResolvedValue(currentState),
        getBaseline: jest.fn().mockResolvedValue(baseline),
      } as never,
      { getPendingOrdersForCard: jest.fn().mockResolvedValue([]) } as unknown as OrderDbService,
      {} as unknown as TerminalHistoryDbService,
      {} as unknown as SafeBoxDbService,
      { resolve: jest.fn().mockReturnValue(JAR_URL) } as unknown as TerminalUrlResolverService,
      {
        findRemainderPoliciesByCardIds: jest.fn().mockResolvedValue(new Map()),
      } as unknown as TmaSaleDbService,
    )

    return service.getDashboard(TRADER_ID)
  }

  it('reports the scraped balance, not the baseline', async () => {
    const { terminals } = await build({ current: SCRAPED_BALANCE, goal: 926_700 }, BASELINE)

    expect(terminals[0].balance).toBe(SCRAPED_BALANCE)
  })

  /** `current` carries a one-hour TTL; the baseline does not. */
  it('falls back to the baseline when nothing has been scraped recently', async () => {
    const { terminals } = await build(null, BASELINE)

    expect(terminals[0].balance).toBe(BASELINE)
  })

  it('reports zero when neither is known', async () => {
    const { terminals } = await build(null, null)

    expect(terminals[0].balance).toBe(0)
  })

  it('still carries the goal from the scraped state', async () => {
    const { terminals } = await build({ current: SCRAPED_BALANCE, goal: 926_700 }, BASELINE)

    expect(terminals[0].goal).toBe(926_700)
  })
})

describe('ExtensionDashboardService — alert shape', () => {
  let alerts: { getUnreadAlerts: jest.Mock }
  let service: ExtensionDashboardService

  beforeEach(() => {
    alerts = { getUnreadAlerts: jest.fn().mockResolvedValue([storedAlert()]) }

    service = new ExtensionDashboardService(
      alerts as unknown as AlertsService,
      { find: jest.fn().mockResolvedValue([]) } as unknown as TerminalDbService,
      {} as never,
      {} as unknown as OrderDbService,
      {} as unknown as TerminalHistoryDbService,
      {} as unknown as SafeBoxDbService,
      {} as unknown as TerminalUrlResolverService,
      {
        findRemainderPoliciesByCardIds: jest.fn().mockResolvedValue(new Map()),
      } as unknown as TmaSaleDbService,
    )
  })

  /**
   * The regression. Both mappers used to spread `metadata` onto the root and
   * `delete` it — left over from when the template interpolated the alert
   * itself. It now passes `alert.metadata`, so a flattened alert rendered its
   * translation with the placeholders intact: "Mismatch of {{amount}} UAH".
   *
   * Only the REST path flattened, so it looked intermittent: an alert arriving
   * over `TERMINAL_ALERT_TRIGGERED` interpolated, and the same alert after a
   * reload did not.
   */
  it('keeps metadata nested, so the client can interpolate its translation', async () => {
    const { alerts: dto } = await service.getAlerts(TRADER_ID)

    expect(dto[0].metadata).toEqual({ amount: 251_500, totalDelta: 251_500 })
  })

  it('does not spread metadata fields onto the root', async () => {
    const { alerts: dto } = await service.getAlerts(TRADER_ID)

    expect(dto[0]).not.toHaveProperty('totalDelta')
  })

  /** The alert's own column, which is a real field and not part of metadata. */
  it('still carries the top-level amount', async () => {
    const { alerts: dto } = await service.getAlerts(TRADER_ID)

    expect(dto[0].amount).toBe(251_500)
  })

  /** The client reads `alert.id || alert._id`; the socket payload sets both. */
  it('carries the same id fields the socket payload does', async () => {
    const { alerts: dto } = await service.getAlerts(TRADER_ID)

    expect(dto[0].id).toBe(ALERT_ID)
    expect(dto[0].alertId).toBe(ALERT_ID)
  })
})
