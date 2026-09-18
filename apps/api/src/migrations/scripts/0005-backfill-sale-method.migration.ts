import { Injectable } from '@nestjs/common'
import { SaleMethod } from '@transacto/contracts'
import { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'
import type { Migration } from 'src/migrations/interfaces'

/**
 * Names the variant of every sale written before there was more than one.
 *
 * A sale now says where it delivers its hryvnia — into a bank jar the scraper
 * watches, or straight to a card the seller confirms — and which it is decides
 * how the rest of the document is read. Half the fields on a jar sale mean
 * nothing on a card sale and the other way round.
 *
 * Every sale that existed before the field was a jar sale, so this states a
 * fact rather than picking a default. It still has to be written down, because
 * every read in this codebase is `.lean()` and a lean read does not apply
 * Mongoose defaults: without this, `saleMethod` comes back `undefined` on
 * historical documents and every branch that switches on it needs a `?? JAR`
 * that somebody will eventually write without.
 *
 * **Not urgent, unlike 0004.** Nothing breaks while it is pending: a sale with
 * no `saleMethod` is not a card sale, and the code reads it as a jar sale
 * either way. What it buys is that the reading stops depending on remembering.
 *
 * **No `down`.** Removing the field would put the data back exactly as it was
 * and leave the running build reading `undefined` where it expects a value —
 * harmless today and one forgotten `??` away from not being. Going back means
 * deploying the old build, which never looked at the field at all.
 */
@Injectable()
export class BackfillSaleMethodMigration implements Migration {
  readonly name = '0005-backfill-sale-method'

  constructor(private readonly saleDb: TmaSaleDbService) {}

  async up(): Promise<string> {
    const named = await this.saleDb.backfillSaleMethod()

    return `Named ${named} sale(s) as ${SaleMethod.JAR}`
  }
}
