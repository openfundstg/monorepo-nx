import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Req,
  UploadedFile,
  UseInterceptors
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import {
  FIAT_RECEIPT_MAX_BYTES,
  type FiatDepositOptionsResponse,
  type FiatDepositWatch,
  type TmaFiatDeposit
} from '@transacto/contracts'
import { UserTypeTMA } from 'src/modules/auth'
import { FiatDepositFacadeService } from 'src/modules/telegram-mini-app/services/fiat-deposit-facade.service'
import { FiatDepositReceiptService } from 'src/modules/telegram-mini-app/services/fiat-deposit-receipt.service'
import { FiatDepositWatchService } from 'src/modules/telegram-mini-app/services/fiat-deposit-watch.service'
import { CreateFiatDepositReqDto } from 'src/modules/telegram-mini-app/dto/create-fiat-deposit.req.dto'
import { SaveFiatDepositWatchReqDto } from 'src/modules/telegram-mini-app/dto/save-fiat-deposit-watch.req.dto'
import type { TmaAuthenticatedRequest } from 'src/shared/interfaces'

/**
 * The multipart part carrying the receipt.
 *
 * Declared here rather than imported from `@types/multer`, which this workspace
 * does not install: three fields are read, and typing them ourselves keeps a
 * types-only dependency out of the tree for the sake of one parameter.
 */
interface UploadedReceipt {
  readonly buffer: Buffer
  readonly originalname: string
  readonly mimetype: string
}

@Controller('tma/fiat-deposits')
export class TmaFiatDepositController {
  constructor(
    private readonly fiatDeposits: FiatDepositFacadeService,
    private readonly receipts: FiatDepositReceiptService,
    private readonly watches: FiatDepositWatchService
  ) {}

  @Get('options')
  @UserTypeTMA()
  async getOptions(@Req() req: TmaAuthenticatedRequest): Promise<FiatDepositOptionsResponse> {
    return this.fiatDeposits.getOptions(req.tmaUser.id)
  }

  @Get('active')
  @UserTypeTMA()
  async getActive(@Req() req: TmaAuthenticatedRequest): Promise<TmaFiatDeposit | null> {
    return this.fiatDeposits.getActive(req.tmaUser.id)
  }

  /**
   * This user's standing request for an amount, or `null`.
   *
   * Declared above `@Get(':id')` and it has to stay there: Nest matches routes
   * in declaration order, and below it `watch` would be read as a top-up id.
   *
   * Its own endpoint as well as a field on `options` because the two screens
   * that show it have nothing else in common — the settings page polls nothing
   * and has no use for a book, a rate or a ceiling.
   */
  @Get('watch')
  @UserTypeTMA()
  async getWatch(@Req() req: TmaAuthenticatedRequest): Promise<FiatDepositWatch | null> {
    return this.watches.getFor(req.tmaUser.id)
  }

  /** `PUT`, because there is one per user and asking twice must not make two. */
  @Put('watch')
  @HttpCode(HttpStatus.OK)
  @UserTypeTMA()
  async saveWatch(
    @Req() req: TmaAuthenticatedRequest,
    @Body() dto: SaveFiatDepositWatchReqDto
  ): Promise<FiatDepositWatch> {
    return this.watches.save(req.tmaUser.id, dto)
  }

  /** Idempotent: unsubscribing twice is a success, not a `404`. */
  @Delete('watch')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UserTypeTMA()
  async removeWatch(@Req() req: TmaAuthenticatedRequest): Promise<void> {
    return this.watches.remove(req.tmaUser.id)
  }

  @Get()
  @UserTypeTMA()
  async list(@Req() req: TmaAuthenticatedRequest): Promise<TmaFiatDeposit[]> {
    return this.fiatDeposits.list(req.tmaUser.id)
  }

  @Get(':id')
  @UserTypeTMA()
  async getById(
    @Req() req: TmaAuthenticatedRequest,
    @Param('id') depositId: string
  ): Promise<TmaFiatDeposit> {
    return this.fiatDeposits.getById(req.tmaUser.id, depositId)
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UserTypeTMA()
  async reserve(
    @Req() req: TmaAuthenticatedRequest,
    @Body() dto: CreateFiatDepositReqDto
  ): Promise<TmaFiatDeposit> {
    return this.fiatDeposits.reserve(req.tmaUser.id, dto.amountUah)
  }

  /**
   * The size limit is set on the interceptor as well as checked in the service.
   * Here it stops a phone from streaming ten megabytes into memory before
   * anything looks at it; there it holds for every caller, including one that
   * never came through this controller.
   */
  @Post(':id/receipts')
  @HttpCode(HttpStatus.CREATED)
  @UserTypeTMA()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: FIAT_RECEIPT_MAX_BYTES } }))
  async uploadReceipt(
    @Req() req: TmaAuthenticatedRequest,
    @Param('id') depositId: string,
    @UploadedFile() file: UploadedReceipt
  ): Promise<TmaFiatDeposit> {
    return this.receipts.submit(req.tmaUser.id, depositId, {
      buffer: file?.buffer,
      fileName: file?.originalname ?? '',
      mimeType: file?.mimetype ?? ''
    })
  }

  /**
   * The way out when the clock beat the receipt.
   *
   * A write, and deliberately so: it stops the automatic release of a payout
   * the user says they paid into, and puts the row where an operator will see
   * it. The Mini App opens the support bot straight afterwards — a flagged row
   * nobody is told about would sit there until the sweep found it.
   */
  @Post(':id/appeal')
  @HttpCode(HttpStatus.OK)
  @UserTypeTMA()
  async appeal(
    @Req() req: TmaAuthenticatedRequest,
    @Param('id') depositId: string
  ): Promise<TmaFiatDeposit> {
    return this.fiatDeposits.appeal(req.tmaUser.id, depositId)
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @UserTypeTMA()
  async cancel(
    @Req() req: TmaAuthenticatedRequest,
    @Param('id') depositId: string
  ): Promise<TmaFiatDeposit> {
    return this.fiatDeposits.cancel(req.tmaUser.id, depositId)
  }
}
