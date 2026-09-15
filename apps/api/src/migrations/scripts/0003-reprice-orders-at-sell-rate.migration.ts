import { Injectable, Logger } from '@nestjs/common'
import { CENTS_PER_USDT } from '@transacto/contracts'
import { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'
import type { PageQuery } from 'src/modules/repositories/interfaces'
import type { Migration } from 'src/migrations/interfaces'

/** Orders per read. */
const PAGE_SIZE = 200

/** `_id` ascending — stable under concurrent inserts, as in `0001` and `0002`. */
const BY_ID: PageQuery['sort'] = { _id: 1 }

/**
 * A ceiling on how many documents one run will collect.
 *
 * Not a business rule: a bound that exists so this can never run away again,
 * whatever else is wrong. A run that hits it converts what it gathered, says
 * so, and is run again.
 */
const MAX_ORDERS_PER_RUN = 100_000

/**
 * Rewrites every sale's `exchangeRate` as the rate it was actually sold at.
 *
 * The field used to hold the **market** rate, with `profitPercent` beside it and
 * every reader expected to combine the two. Most did. The partial settlement did
 * not: it converted the hryvnia a user had actually received at the market rate
 * rather than at the rate they sold it at, which charged them about 2% more USDT
 * than the sale was priced at, quietly, on every partial fill. That is the bug
 * this removes, by removing the possibility of it — afterwards there is one rate
 * on the document and no way to read it wrongly.
 *
 * **The rate is derived from the stake, not from the stored rate.** A sale's
 * stake is the target at the rate it sold at, so the rate is the target divided
 * by the stake — recovered from `fiatAmount` and `frozenUsdt`, two fields no
 * version of this migration has ever written.
 *
 * That is deliberate, and it is the second version of this file. The first
 * multiplied the stored rate by the stored markup, which is the same arithmetic
 * and correct on a document nobody had touched. It was not correct on a document
 * this migration had already touched, and it touched them eleven thousand times:
 * Mongoose's default `strict: true` silently dropped the `$unset` of two paths
 * the schema no longer declares, so `profitPercent` survived every pass, the
 * document never left the result set, and `$set` re-marked-up the rate on every
 * lap until all sixteen orders on production read 1e97 kopecks per USDT.
 *
 * Deriving from the stake makes this **self-healing**: it computes the same
 * answer whether the stored rate is untouched, marked up once, or marked up
 * eleven thousand times, because it does not read the stored rate at all. The
 * repository fix (`strict: false`) is what stops the loop; this is what makes it
 * safe to run against the mess the loop left. Both were needed.
 *
 * Safe to re-run: `profitPercent` existing is what identifies an unconverted
 * document, and the update that writes the new rate removes it in the same
 * operation.
 *
 * No `down`. The market rate is not recoverable from the sell rate once the
 * markup is gone, and reversing this would mean inventing one.
 */
@Injectable()
export class RepriceOrdersAtSellRateMigration implements Migration {
  readonly name = '0003-reprice-orders-at-sell-rate'

  private readonly logger = new Logger(RepriceOrdersAtSellRateMigration.name)

  constructor(private readonly sales: TmaSaleDbService) {}

  async up(): Promise<string> {
    // Everything to convert is gathered **before** anything is written, and the
    // walk is over that fixed list. The first version re-queried after each
    // page and looped while documents came back — which is a loop that only
    // ends if every write really removes its document from the filter, and the
    // one thing that went wrong is that they did not. A list read once cannot
    // do that whatever the writes do.
    const pending = await this.collect()
    if (pending.length === 0) return 'repriced 0 order(s) at their own sell rate'

    let repriced = 0
    let skipped = 0

    for (const order of pending) {
      // The stake is the target at the rate it sold at, so the rate is the
      // target divided by the stake. An order with no stake — one that failed
      // before anything was frozen — has nothing to divide by and nothing that
      // needs a rate.
      if (order.frozenUsdt <= 0 || order.fiatAmount <= 0) {
        skipped++
        this.logger.warn(
          `Sale ${order.publicId} has fiatAmount ${order.fiatAmount} and frozenUsdt ` +
            `${order.frozenUsdt}; there is no rate to recover from that. Left as it is.`
        )
        continue
      }

      const sell = Math.round((order.fiatAmount / order.frozenUsdt) * CENTS_PER_USDT)

      if (await this.sales.repriceToSellRate(order._id, sell)) {
        repriced++
        this.logger.log(
          `Sale ${order.publicId}: ${order.fiatAmount} kopecks staked at ` +
            `${order.frozenUsdt} cents is ${sell} kopecks/USDT`
        )
      }
    }

    return (
      `repriced ${repriced} order(s) at their own sell rate` +
      (skipped > 0 ? `, ${skipped} left alone and logged` : '')
    )
  }

  /**
   * Every order still carrying the old fields, read before anything is written.
   *
   * Paging with `skip` is correct precisely because nothing is being written
   * while it runs — the set is stable for the length of the read. It stops at
   * {@link MAX_ORDERS_PER_RUN} rather than trusting the collection to be
   * finite, which is the cheap half of never doing this again.
   */
  private async collect(): Promise<
    { _id: Parameters<TmaSaleDbService['repriceToSellRate']>[0]
      publicId: string
      fiatAmount: number
      frozenUsdt: number }[]
  > {
    const gathered = []

    for (let skip = 0; skip < MAX_ORDERS_PER_RUN; skip += PAGE_SIZE) {
      const { items } = await this.sales.findPricedAtMarketRate({
        skip,
        limit: PAGE_SIZE,
        sort: BY_ID
      })

      gathered.push(...items)

      if (items.length < PAGE_SIZE) return gathered
    }

    this.logger.warn(
      `Stopped after gathering ${gathered.length} orders — the run cap. Converting these, ` +
        `then run the migration again for the rest.`
    )

    return gathered
  }
}
