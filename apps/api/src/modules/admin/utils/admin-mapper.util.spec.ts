import { AdminDocumentKind } from '@transacto/contracts'
import { Types } from 'mongoose'
import { toAdminDocument } from 'src/modules/admin/utils'
import type { AdminDocumentFeedRow } from 'src/modules/repositories/admin-feed-db/interfaces'

const documentRow = (overrides: Partial<AdminDocumentFeedRow> = {}): AdminDocumentFeedRow =>
  ({
    _id: new Types.ObjectId(),
    kind: AdminDocumentKind.FIAT_RECEIPT,
    telegramId: 592,
    bank: null,
    status: 'ACCEPTED',
    rejection: null,
    amountUah: 60_000,
    sizeBytes: 21_400,
    storedName: 'ffffffffffffffffffffffff.pdf',
    uploadedAt: new Date('2026-09-18T19:10:00Z'),
    purgedAt: null,
    externalUrl: null,
    saleId: null,
    salePublicId: null,
    cardOrderId: null,
    fiatDepositId: new Types.ObjectId(),
    payoutId: 2_054_424,
    periodFrom: null,
    periodTo: null,
    ownerName: null,
    recipientChecked: true,
    ...overrides
  }) as AdminDocumentFeedRow

/**
 * Whether the panel offers a download.
 *
 * The one field on this row that decides what an operator is allowed to click,
 * and it is a claim about two different things at once: a document this product
 * never kept a copy of, and one whose copy the retention sweep has since
 * removed. Both are ordinary, both mean "there is nothing to serve", and the
 * screen says which — but only if this is right.
 */
describe('toAdminDocument fileAvailable', () => {
  it('offers a document whose file is on disk', () => {
    expect(toAdminDocument(documentRow(), 'user').fileAvailable).toBe(true)
  })

  it('refuses one the retention sweep has emptied', () => {
    const row = documentRow({ purgedAt: new Date('2026-09-20T04:00:00Z') })

    expect(toAdminDocument(row, 'user').fileAvailable).toBe(false)
  })

  it('refuses one this product never archived', () => {
    expect(toAdminDocument(documentRow({ storedName: null }), 'user').fileAvailable).toBe(false)
  })

  /**
   * A receipt written before the archive existed, as Mongo actually hands it
   * back: `$project` omits a path the source document does not have, so the
   * field is **absent** rather than null — and `undefined !== null` is `true`.
   *
   * The projection now reads every such field through `$ifNull`, but this row
   * is what arrives if that is ever undone, and the answer must not change.
   */
  it('refuses one whose fields predate the archive entirely', () => {
    const legacy = documentRow()
    delete (legacy as { storedName?: unknown }).storedName
    delete (legacy as { purgedAt?: unknown }).purgedAt

    expect(toAdminDocument(legacy, 'user').fileAvailable).toBe(false)
  })

  /**
   * The case that tells a correct implementation from a lucky one.
   *
   * An absent `storedName` beside an explicit `purgedAt: null` — a receipt
   * whose row carries the schema's default but whose name was never written.
   * Under `storedName !== null && purgedAt === null` both halves are true and
   * the panel offers a download of a file that was never stored; under the
   * truthiness form it is refused, which is the only right answer.
   */
  it('refuses one with no stored name even where nothing was ever purged', () => {
    const row = documentRow({ purgedAt: null })
    delete (row as { storedName?: unknown }).storedName

    expect(toAdminDocument(row, 'user').fileAvailable).toBe(false)
  })
})
