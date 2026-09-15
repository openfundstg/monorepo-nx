import type { Type } from '@nestjs/common'
import { BackfillBalanceEntriesMigration } from 'src/migrations/scripts/0001-backfill-balance-entries.migration'
import { ReleaseOrphanedStakesMigration } from 'src/migrations/scripts/0002-release-orphaned-stakes.migration'
import { RepriceOrdersAtSellRateMigration } from 'src/migrations/scripts/0003-reprice-orders-at-sell-rate.migration'
import { RenameScrollOrdersToSalesMigration } from 'src/migrations/scripts/0004-rename-scroll-orders-to-sales.migration'
import type { Migration } from 'src/migrations/interfaces'

/** The DI token the runner receives the ordered list under. */
export const MIGRATIONS = 'MIGRATIONS'

/**
 * Every migration, oldest first. **Append only, never reorder.**
 *
 * A list rather than a directory scan, because the API ships as a single
 * webpack bundle: there is no `src/migrations` on the running host to read, and
 * a `require` of a computed path is not something the bundler can follow. The
 * cost is one line per migration; the benefit is that the order is stated
 * rather than inferred from a filesystem sort that differs between machines.
 */
export const MIGRATION_CLASSES: readonly Type<Migration>[] = [
  BackfillBalanceEntriesMigration,
  ReleaseOrphanedStakesMigration,
  RepriceOrdersAtSellRateMigration,
  RenameScrollOrdersToSalesMigration
]
