import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { TmaDeposit, TmaDepositSchema } from 'src/modules/repositories/tma-deposit-db/schemas'
import {
  TmaFiatDeposit,
  TmaFiatDepositSchema
} from 'src/modules/repositories/tma-fiat-deposit-db/schemas'
import { TmaSale, TmaSaleSchema } from 'src/modules/repositories/tma-sale-db/schemas'
import { AdminDepositFeedDbService, AdminDocumentFeedDbService } from './services'

/**
 * The reads that span more than one collection.
 *
 * A repository module of its own because neither of these belongs to a
 * collection: the deposits book is `tma_deposits` and `tma_fiat_deposits` read
 * as one, and the archive is the documents embedded in `tma_sales` and
 * `tma_fiat_deposits`. Putting either on one collection's `-db` service would
 * make that service reach into another's, which is the thing this layer exists
 * to keep from happening.
 *
 * It registers the three schemas rather than importing the other `-db` modules,
 * because what it needs is the models, not their services. Registering a schema
 * twice is free — Mongoose keys models by name on one connection and hands back
 * the same one.
 *
 * **Read-only, and it must stay that way.** Nothing here writes: a write that
 * spanned two collections would be a settlement path, and settlement paths
 * belong to the services that own the money.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TmaDeposit.name, schema: TmaDepositSchema },
      { name: TmaFiatDeposit.name, schema: TmaFiatDepositSchema },
      { name: TmaSale.name, schema: TmaSaleSchema }
    ])
  ],
  providers: [AdminDepositFeedDbService, AdminDocumentFeedDbService],
  exports: [AdminDepositFeedDbService, AdminDocumentFeedDbService]
})
export class AdminFeedDbModule {}
