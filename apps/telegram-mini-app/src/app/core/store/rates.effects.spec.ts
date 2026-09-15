import { TestBed } from '@angular/core/testing'
import { Injector, provideZonelessChangeDetection, runInInjectionContext } from '@angular/core'
import { provideMockActions } from '@ngrx/effects/testing'
import { Subject, of, throwError } from 'rxjs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Action } from '@ngrx/store'
import type { TmaRatesResponse } from '@transacto/contracts'
import { RatesApiService } from '../services/rates.api.service'
import { ratesActions } from './rates.actions'
import { loadRates, pollRates } from './rates.effects'

const RATES: TmaRatesResponse = { buy: 4626, sell: 4743 }

/**
 * The poll is the whole point of this slice: one request, on one timer, feeding
 * every screen. A regression here is invisible — the app keeps working, it
 * simply starts quoting a price from whenever it last happened to ask.
 */
describe('the rates poll', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const collect = () => {
    TestBed.resetTestingModule()
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] })

    const emitted: Action[] = []
    const subscription = runInInjectionContext(TestBed.inject(Injector), () =>
      pollRates()
    ).subscribe((action) => emitted.push(action))

    // `timer(0, …)` still schedules its first emission, so the fake clock has
    // to be nudged past zero before anything has been asked.
    vi.advanceTimersByTime(0)

    return { emitted, subscription }
  }

  it('asks immediately rather than after the first interval', () => {
    const { emitted, subscription } = collect()

    expect(emitted).toEqual([ratesActions.load()])
    subscription.unsubscribe()
  })

  /** Thirty seconds, which is what the product asked for and what the copy says. */
  it('asks again every thirty seconds', () => {
    const { emitted, subscription } = collect()

    vi.advanceTimersByTime(29_000)
    expect(emitted).toHaveLength(1)

    vi.advanceTimersByTime(1_000)
    expect(emitted).toHaveLength(2)

    vi.advanceTimersByTime(30_000)
    expect(emitted).toHaveLength(3)

    subscription.unsubscribe()
  })
})

describe('reading the rates', () => {
  const actions = new Subject<Action>()

  const run = (api: Partial<RatesApiService>) => {
    TestBed.resetTestingModule()
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideMockActions(() => actions),
        { provide: RatesApiService, useValue: api }
      ]
    })

    const emitted: Action[] = []
    runInInjectionContext(TestBed.inject(Injector), () => loadRates()).subscribe((action) =>
      emitted.push(action)
    )

    actions.next(ratesActions.load())

    return emitted
  }

  it('publishes both rates from the one response', () => {
    expect(run({ getRates: () => of(RATES) })).toEqual([ratesActions.loadSuccess({ rates: RATES })])
  })

  /**
   * A failure changes nothing on purpose. A momentary outage should leave a
   * thirty-second-old figure on screen rather than blank it, and the next tick
   * asks again — so the cost of an outage is one stale reading, not an empty
   * one.
   */
  it('keeps whatever is held when the market cannot be reached', () => {
    expect(run({ getRates: () => throwError(() => new Error('offline')) })).toEqual([
      ratesActions.loadFailure()
    ])
  })
})
