import { Injectable } from '@nestjs/common'
import { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'
import type { Migration } from 'src/migrations/interfaces'

/**
 * Removes the receiver's name from every sale.
 *
 * A sale used to keep a copy of the name its terminal was created with — a
 * jar's owner as the bank named them, a Telegram display name, or whatever a
 * card seller typed — and, on a card sale, the name a bank statement replaced it
 * with. The copy's stated purpose was letting support answer "what name did the
 * payer see?" without asking Transacto. No screen ever rendered it: it was a
 * person's name, held forever, for a question nobody asked. The terminal holds
 * the name that matters and is where an operator reads it.
 *
 * **Not urgent.** The running build neither writes nor reads the field, so a
 * pending run changes nothing a user sees. What it removes is the data itself,
 * which is the point, and which only this can remove: the documents written
 * before the change keep the name until it runs.
 *
 * **No `down`, and there cannot be one.** The names are not kept anywhere this
 * could read them back from. That is what the migration is for.
 */
@Injectable()
export class ForgetReceiverNamesMigration implements Migration {
  readonly name = '0006-forget-receiver-names'

  constructor(private readonly saleDb: TmaSaleDbService) {}

  async up(): Promise<string> {
    const forgotten = await this.saleDb.forgetReceiverNames()

    return `Removed the receiver's name from ${forgotten} sale(s)`
  }
}
