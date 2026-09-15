/** Milliseconds between one task starting and the next. */
export const TRADER_REQUEST_STAGGER_MS = 50

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Runs a task per item, starting them `delayMs` apart, and settles them all.
 *
 * `Promise.allSettled(items.map(task))` fires every request in the same tick.
 * With two traders that is two simultaneous calls to the same upstream on every
 * cron tick, and the crons overlap — `credentials_list` and `orders_list` both
 * land on the same second. Spacing the *starts* costs nothing measurable and
 * stops us arriving as a burst.
 *
 * Still concurrent, deliberately: this is a stagger, not a queue. A slow trader
 * delays nobody, and the pass takes as long as its slowest member plus the
 * spread — not the sum.
 *
 * Rejections are settled rather than thrown, exactly as `allSettled` does, so
 * one trader's failure cannot cost the others their turn.
 */
export const settleStaggered = async <T, R>(
  items: readonly T[],
  delayMs: number,
  task: (item: T, index: number) => Promise<R>
): Promise<PromiseSettledResult<R>[]> =>
  Promise.allSettled(
    items.map(async (item, index) => {
      // Cumulative, so the n-th task starts n * delay in rather than every task
      // waiting the same amount and arriving together anyway.
      if (index > 0) await sleep(index * delayMs)

      return task(item, index)
    })
  )
