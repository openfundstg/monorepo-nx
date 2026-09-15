import { TestBed } from '@angular/core/testing'
import { provideZonelessChangeDetection } from '@angular/core'
import { provideTranslateService } from '@ngx-translate/core'
import { HistoryTableComponent } from './history-table.component'
import type { HistoryLog } from './history.interface'

/** As the table renders them: newest first. Figures from a real terminal. */
const LOGS = [
  { balance: 389_800, baseline: 389_800, expectedBalance: 572_000 },
  { balance: 389_800, baseline: 389_800, expectedBalance: 541_600 },
  { balance: 329_400, baseline: 329_400, expectedBalance: 541_600 },
  { balance: 278_500, baseline: 250_000, expectedBalance: 542_600 },
  { balance: 217_900, baseline: 217_900, expectedBalance: 512_000 }
].map((row, index) => ({ ...row, _id: `log-${index}`, delta: 0 }) as unknown as HistoryLog)

describe('HistoryTableComponent rows', () => {
  let component: HistoryTableComponent

  beforeEach(() => {
    TestBed.configureTestingModule({
      // The table is presentational — no loader, no socket, nothing to stub.
      // That it needs neither is the point of the extraction.
      providers: [provideZonelessChangeDetection(), provideTranslateService()]
    })

    const fixture = TestBed.createComponent(HistoryTableComponent)
    fixture.componentRef.setInput('logs', LOGS)
    component = fixture.componentInstance
  })

  /**
   * The reported bug. All three money columns already had arrow markup, but the
   * actual-balance one read `log.delta` straight off the server — which writes
   * a literal `0` — so it was the only column that never showed one.
   */
  it('reports the movement of the actual balance', () => {
    const deltas = component.rows().map((row) => row.balanceDelta)

    expect(deltas).toEqual([undefined, 60_400, 50_900, 60_600, undefined])
  })

  it('reports the movement of the expected balance', () => {
    const deltas = component.rows().map((row) => row.expectedDelta)

    expect(deltas).toEqual([30_400, undefined, -1_000, 30_600, undefined])
  })

  /** Balance minus baseline: the money no matched order accounts for. */
  it('reports the movement of the unrecognized figure', () => {
    const rows = component.rows()

    expect(rows.map((row) => row.unrecognized)).toEqual([0, 0, 0, 28_500, 0])
    expect(rows.map((row) => row.unrecognizedDelta)).toEqual([
      undefined,
      undefined,
      -28_500,
      28_500,
      undefined
    ])
  })

  /** The oldest row has nothing below it, so no column may claim a movement. */
  it('leaves every column of the oldest row without a movement', () => {
    const oldest = component.rows()[LOGS.length - 1]

    expect([oldest.balanceDelta, oldest.expectedDelta, oldest.unrecognizedDelta]).toEqual([
      undefined,
      undefined,
      undefined
    ])
  })

  /** All three read the same rule, so none can drift from the others again. */
  it('measures every column against the row below it', () => {
    const [newest] = component.rows()

    expect(newest.balance).toBe(LOGS[0].balance)
    expect(newest.expectedBalance).toBe(LOGS[0].expectedBalance)
    expect(newest.unrecognized).toBe(LOGS[0].balance - LOGS[0].baseline)
  })
})
