import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common'
import { Public, UserTypeTMA } from 'src/modules/auth'
import type { TmaAuthenticatedRequest } from 'src/shared/interfaces'
import { DepositFacadeService } from 'src/modules/telegram-mini-app/services/deposit-facade.service'
import { TmaDepositDbService } from 'src/modules/repositories/tma-deposit-db/services'
import { CreateDepositDto } from 'src/modules/telegram-mini-app/dto/create-deposit.dto'
import { VerifyTxDto } from 'src/modules/telegram-mini-app/dto/verify-tx.dto'

@Controller('tma/deposits')
export class TmaDepositController {
  constructor(
    private readonly depositFacade: DepositFacadeService,
    private readonly depositDbService: TmaDepositDbService
  ) {}

  /**
   * GET /api/tma/deposits/config
   * Public config endpoint — no auth needed.
   */
  @Get('config')
  @Public()
  async getConfig() {
    const exchangeRate = await this.depositFacade.getBuyRate()

    return {
      walletAddress: this.depositFacade.getWalletAddress(),
      exchangeRate,
      expiryMinutes: 60
    }
  }

  /**
   * POST /api/tma/deposits
   * Creates a new deposit.
   */
  @Post()
  @UserTypeTMA()
  async createDeposit(@Req() req: TmaAuthenticatedRequest, @Body() dto: CreateDepositDto) {
    const tmaUser = req.tmaUser
    const { deposit, walletAddress } = await this.depositFacade.createDeposit(
      tmaUser.id,
      dto.cryptoAmount
    )

    return {
      depositId: deposit._id.toString(),
      cryptoAmount: deposit.cryptoAmount,
      fiatEquivalent: deposit.fiatEquivalent,
      exchangeRate: deposit.exchangeRate,
      walletAddress,
      expiresAt: deposit.expiresAt,
      status: deposit.status
    }
  }

  /**
   * POST /api/tma/deposits/:id/verify-tx
   * Verifies a blockchain TxID for the deposit.
   */
  @Post(':id/verify-tx')
  @UserTypeTMA()
  async verifyTx(
    @Req() req: TmaAuthenticatedRequest,
    @Param('id') depositId: string,
    @Body() dto: VerifyTxDto
  ) {
    const tmaUser = req.tmaUser
    return this.depositFacade.verifyDeposit(depositId, dto.txId, tmaUser.id)
  }

  /**
   * GET /api/tma/deposits
   * Returns all deposits for the authenticated user.
   */
  @Get()
  @UserTypeTMA()
  async listDeposits(@Req() req: TmaAuthenticatedRequest) {
    const tmaUser = req.tmaUser
    const deposits = await this.depositDbService.findByTelegramId(tmaUser.id)
    return { deposits }
  }

  /**
   * GET /api/tma/deposits/:id
   * Returns a single deposit with current status.
   */
  @Get(':id')
  @UserTypeTMA()
  async getDeposit(@Req() req: TmaAuthenticatedRequest, @Param('id') id: string) {
    const tmaUser = req.tmaUser
    const deposit = await this.depositDbService.findById(id)
    if (!deposit || deposit.telegramId !== tmaUser.id) {
      return { error: 'Deposit not found' }
    }
    return { deposit }
  }
}
