import { settleStaggered, TRADER_REQUEST_STAGGER_MS } from 'src/shared/utils/stagger.util'

describe('settleStaggered', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  /** Drives the fake clock until every scheduled start has fired. */
  const runAll = async <T>(pending: Promise<T>): Promise<T> => {
    await jest.runAllTimersAsync()

    return pending
  }

  it('starts each task one interval further in', async () => {
    const startedAt: number[] = []
    const base = Date.now()

    await runAll(
      settleStaggered(['a', 'b', 'c'], 50, async () => {
        startedAt.push(Date.now() - base)
      }),
    )

    expect(startedAt).toEqual([0, 50, 100])
  })

  it('runs the first task without waiting at all', async () => {
    const started = jest.fn()

    const pending = settleStaggered(['a', 'b'], 50, async (item) => started(item))
    // Nothing has advanced the clock yet.
    await Promise.resolve()

    expect(started).toHaveBeenCalledWith('a')
    expect(started).not.toHaveBeenCalledWith('b')

    await runAll(pending)
  })

  it('returns a result per item, in order', async () => {
    const results = await runAll(settleStaggered([1, 2, 3], 50, async (n) => n * 10))

    expect(results).toEqual([
      { status: 'fulfilled', value: 10 },
      { status: 'fulfilled', value: 20 },
      { status: 'fulfilled', value: 30 },
    ])
  })

  /** One trader's failure must never cost the others their turn. */
  it('settles a rejection instead of throwing', async () => {
    const results = await runAll(
      settleStaggered(['ok', 'bad'], 50, async (item) => {
        if (item === 'bad') throw new Error('502')

        return item
      }),
    )

    expect(results[0].status).toBe('fulfilled')
    expect(results[1].status).toBe('rejected')
  })

  /**
   * A stagger, not a queue: the spread is added once, not per task, so a slow
   * trader delays nobody and the pass is not the sum of its members.
   */
  it('does not wait for one task before starting the next', async () => {
    const finished: string[] = []

    await runAll(
      settleStaggered(['slow', 'fast'], 50, async (item) => {
        if (item === 'slow') await new Promise((resolve) => setTimeout(resolve, 10_000))
        finished.push(item)
      }),
    )

    expect(finished).toEqual(['fast', 'slow'])
  })

  it('handles an empty list', async () => {
    await expect(settleStaggered([], 50, async () => undefined)).resolves.toEqual([])
  })

  it('is the interval the syncs were asked for', () => {
    expect(TRADER_REQUEST_STAGGER_MS).toBe(50)
  })
})
