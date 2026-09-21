import type { Model, PipelineStage } from 'mongoose'
import type { Page, PageQuery } from 'src/modules/repositories/interfaces'

/**
 * What `$facet` hands back: one document holding the page and the count.
 *
 * `total` is an array because `$count` produces a stage output, and that output
 * is **empty when nothing matched** — which is why every read of it below goes
 * through the helper rather than indexing directly. `result.total[0].value` on
 * an empty book throws, and an empty book is an ordinary state.
 */
interface FacetResult<TRow> {
  readonly items: TRow[]
  readonly total: { value: number }[]
}

/**
 * The last three stages of every cross-collection feed, and the two traps in
 * them.
 *
 * Both feeds here sort *after* a `$unionWith`, which is the price of reading
 * two collections as one book: the sort cannot use an index, and the page and
 * the count have to come out of one pass or they can disagree about a row that
 * landed between them.
 *
 * - **`allowDiskUse`** because an operator's book spans every deposit ever
 *   made, and the alternative to spilling is a hard failure at 100 MB.
 * - **The empty case** is the whole reason this is shared. Nothing matched is
 *   `{ items: [], total: [] }`, and the obvious unwrapping of that throws.
 */
export const facetPage = async <TRow, TDoc>(
  model: Model<TDoc>,
  stages: PipelineStage[],
  page: PageQuery
): Promise<Page<TRow>> => {
  const [result] = await model
    .aggregate<FacetResult<TRow>>([
      ...stages,
      {
        $facet: {
          items: [{ $sort: page.sort }, { $skip: page.skip }, { $limit: page.limit }],
          total: [{ $count: 'value' }]
        }
      }
    ])
    .allowDiskUse(true)
    .exec()

  return { items: result?.items ?? [], total: result?.total[0]?.value ?? 0 }
}
