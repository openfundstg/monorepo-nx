import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseEnumPipe,
  Query,
  Res
} from '@nestjs/common'
import type { Response } from 'express'
import {
  AdminDocumentDisposition,
  AdminDocumentKind,
  ERROR,
  type AdminDocumentListItem,
  type AdminPaginatedRes
} from '@transacto/contracts'
import { UserTypeAdmin } from 'src/modules/auth'
import { AdminDocumentsPageQueryDto } from 'src/modules/admin/dto'
import { AdminDocumentsService } from 'src/modules/admin/services'

/**
 * Every file this product holds, and the bytes of any one of them.
 *
 * **Addressed by kind and id**, because a statement and a receipt live in
 * different collections and mint their own ids — an id alone would be a lookup
 * that is right almost always.
 */
@Controller('admin/documents')
export class AdminDocumentsController {
  constructor(private readonly documents: AdminDocumentsService) {}

  @Get()
  @UserTypeAdmin()
  async list(
    @Query() query: AdminDocumentsPageQueryDto
  ): Promise<AdminPaginatedRes<AdminDocumentListItem>> {
    return this.documents.list(query)
  }

  /**
   * One document's bytes.
   *
   * **Inline by default, and that is the change worth naming.** These were
   * always sent as attachments, which meant an operator checking whether a
   * statement covered the right fortnight had to download it, find it and open
   * it — three steps to answer a question a glance answers. `?disposition=
   * attachment` still files it, for the case where that is what the errand is.
   *
   * Streamed rather than buffered: these run to hundreds of kilobytes and there
   * is no reason to hold one whole while a browser reads it.
   */
  @Get(':kind/:id/file')
  @UserTypeAdmin()
  async file(
    @Param('kind', new ParseEnumPipe(AdminDocumentKind)) kind: AdminDocumentKind,
    @Param('id') id: string,
    @Query('disposition') disposition: AdminDocumentDisposition | undefined,
    @Res() response: Response
  ): Promise<void> {
    const found = await this.documents.file(kind, id)

    // The document exists and its bytes do not — a retention sweep, or an
    // upload from before this product archived anything. A 404 with its own
    // code, so the panel can say which rather than showing a broken download.
    if (found === null) throw new NotFoundException(ERROR.ADMIN.DOCUMENT_FILE_GONE)

    const shown =
      disposition === AdminDocumentDisposition.ATTACHMENT
        ? AdminDocumentDisposition.ATTACHMENT
        : AdminDocumentDisposition.INLINE

    response.setHeader('Content-Type', found.contentType)
    response.setHeader('Content-Disposition', `${shown}; filename="${found.fileName}"`)

    found.stream.pipe(response)
  }
}
