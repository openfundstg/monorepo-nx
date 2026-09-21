import { Injectable, NotFoundException } from '@nestjs/common'
import {
  AdminDocumentKind,
  ERROR,
  type AdminDocumentListItem,
  type AdminDocumentsPageReq,
  type AdminPaginatedRes
} from '@transacto/contracts'
import { Types } from 'mongoose'
import type { ReadStream } from 'node:fs'
import { ADMIN_PAGE, ADMIN_SORTABLE } from 'src/modules/admin/constants'
import { clampLimit } from 'src/modules/admin/dto'
import { AdminUsersService } from 'src/modules/admin/services/admin-users.service'
import { toAdminDocument, toPageQuery, toPaginatedRes } from 'src/modules/admin/utils'
import {
  AdminDocumentFeedDbService,
  type AdminDocumentFeedFilter
} from 'src/modules/repositories/admin-feed-db/services'
import type { AdminDocumentFeedRow } from 'src/modules/repositories/admin-feed-db/interfaces'
import type { DocumentStorage } from 'src/modules/telegram-mini-app/services/document-storage.base'
import { FiatReceiptStorageService } from 'src/modules/telegram-mini-app/services/fiat-receipt-storage.service'
import { SaleStatementStorageService } from 'src/modules/telegram-mini-app/services/sale-statement-storage.service'

/** How one kind of document is stored and what it should be called. */
interface DocumentKindHandling {
  readonly storage: DocumentStorage
  /** Without an extension — the stored file's own decides that. */
  readonly fileName: (row: AdminDocumentFeedRow) => string
}

/** What a download hands back: the bytes, a name to file them under, and a type. */
export interface AdminDocumentFile {
  readonly stream: ReadStream
  readonly fileName: string
  readonly contentType: string
}

/**
 * Served by extension, because the archive holds more than PDFs.
 *
 * A statement is always a PDF; a receipt may be a screenshot. Sending every
 * document as `application/pdf` would make a browser download a JPEG it could
 * have shown, which is the difference between glancing at a receipt and filing
 * it somewhere to open by hand.
 */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp'
}

/**
 * Every document this product holds, as one archive.
 *
 * **It exists because "which file is this?" had no answer.** A statement was
 * reachable only through the dispute it settled and a receipt was reachable
 * only through Transacto's own panel — so an operator holding a file, or asked
 * about one, had to already know which of the two it was and which screen it
 * lived behind. One list, addressed by what a document is *about*, is the
 * answer: every row names its sale or its top-up and the Transacto order or
 * payout behind it.
 *
 * It judges nothing and settles nothing. A statement's verdict is reached by
 * `SaleStatementService`, a receipt's by the verification facade and then by
 * Transacto; what this offers is the evidence and the trail back to what it
 * answered.
 */
@Injectable()
export class AdminDocumentsService {
  constructor(
    private readonly feed: AdminDocumentFeedDbService,
    private readonly usersService: AdminUsersService,
    private readonly statements: SaleStatementStorageService,
    private readonly receipts: FiatReceiptStorageService
  ) {}

  async list(request: AdminDocumentsPageReq): Promise<AdminPaginatedRes<AdminDocumentListItem>> {
    const limit = clampLimit(request.limit)
    const paging = { ...request, limit }

    const page = await this.feed.findPage(
      { kind: request.filter, search: request.search },
      toPageQuery(paging, ADMIN_SORTABLE.DOCUMENTS)
    )

    return toPaginatedRes(page, paging, await this.namer(page.items))
  }

  /**
   * Everything sent about one sale, newest first.
   *
   * Capped at the same preview size every detail page uses. A sale with more
   * documents than that is one whose whole story is in the archive, filtered by
   * its own code — which is a link, not a scroll.
   */
  async forSale(saleId: Types.ObjectId): Promise<readonly AdminDocumentListItem[]> {
    return this.preview({ saleId })
  }

  /** Everything sent about one top-up, newest first. */
  async forFiatDeposit(depositId: Types.ObjectId): Promise<readonly AdminDocumentListItem[]> {
    return this.preview({ fiatDepositId: depositId })
  }

  private async preview(
    filter: AdminDocumentFeedFilter
  ): Promise<readonly AdminDocumentListItem[]> {
    const page = await this.feed.findPage(filter, {
      skip: 0,
      limit: ADMIN_PAGE.DETAIL_PREVIEW,
      sort: { uploadedAt: -1 }
    })

    const name = await this.namer(page.items)

    return page.items.map(name)
  }

  /**
   * The bytes of one document.
   *
   * `null` rather than an exception when the file is gone, so the caller can
   * answer 404 and mean "this document existed and its bytes do not" — which is
   * a different thing from an id that names nothing, and an empty download
   * would read as neither.
   */
  async file(kind: AdminDocumentKind, id: string): Promise<AdminDocumentFile | null> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException(ERROR.ADMIN.DOCUMENT_NOT_FOUND)

    const row = await this.feed.findById(kind, new Types.ObjectId(id))
    if (row === null) throw new NotFoundException(ERROR.ADMIN.DOCUMENT_NOT_FOUND)

    // Past its retention, or never archived at all. The record of what it said
    // is still on the row and the bytes are deliberately gone.
    if (row.storedName === null || row.purgedAt !== null) return null

    const kindOf = this.kinds()[kind]
    const stream = kindOf.storage.read(row.storedName)
    if (stream === null) return null

    const extension = row.storedName.split('.').pop() ?? 'pdf'

    return {
      stream,
      fileName: `${kindOf.fileName(row)}.${extension}`,
      contentType: CONTENT_TYPES[extension] ?? 'application/octet-stream'
    }
  }

  /**
   * Everything that differs between the two kinds of document, in one place.
   *
   * Which archive holds it and what an operator should find it called are the
   * same question asked twice — *which kind is this?* — and they were two
   * ternaries, which is two places to answer it and one place to forget. A
   * `Record` with no fallback, so a third kind of evidence fails to compile
   * here until both answers exist for it.
   *
   * A method rather than a module constant because the storages are injected.
   */
  private kinds(): Readonly<Record<AdminDocumentKind, DocumentKindHandling>> {
    return {
      [AdminDocumentKind.SALE_STATEMENT]: {
        storage: this.statements,
        // An operator filing a statement against an appeal has the Transacto
        // order number on the appeal. A file called by its own database id is
        // a file nobody can put anywhere.
        fileName: (row) =>
          `statement-order-${row.cardOrderId ?? row.salePublicId ?? 'unknown'}`
      },
      [AdminDocumentKind.FIAT_RECEIPT]: {
        storage: this.receipts,
        fileName: (row) => `receipt-payout-${row.payoutId ?? 'unknown'}`
      }
    }
  }

  /**
   * One name lookup for a whole page, rather than one per row.
   *
   * The same choice every other list here makes: the display name is a join
   * across another collection, and doing it per row turns a page into fifty
   * queries. What a missing user is called is `namerFor`'s answer, not this
   * method's.
   */
  private async namer(
    rows: readonly AdminDocumentFeedRow[]
  ): Promise<(row: AdminDocumentFeedRow) => AdminDocumentListItem> {
    const name = await this.usersService.namerFor(rows.map((row) => row.telegramId))

    return (row) => toAdminDocument(row, name(row.telegramId))
  }
}
