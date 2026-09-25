import { Controller, Get } from '@nestjs/common'
import type { TrustLevelLadderResponse } from '@transacto/contracts'
import { Public } from 'src/modules/auth'
import { trustLadder } from 'src/shared/constants'

/**
 * The trust ladder: what each level requires and what it allows.
 *
 * Served so the Mini App can draw its progress bar and its levels page from the
 * same numbers the backend grants levels by. It used to keep its own copy of
 * the turnover milestones, with a comment asking whoever moved a threshold to
 * remember that file too — and `getTrustLevel` did not even read `TRUST_LEVELS`
 * itself, so there were three statements of one rule and no authority among
 * them.
 *
 * Static configuration, so it is `@Public()` and needs no user: the ladder is
 * the same for everyone, and which rung a caller is on comes from `/auth`.
 */
@Controller('tma/trust-levels')
export class TmaTrustLevelController {
  @Get()
  @Public()
  getLadder(): TrustLevelLadderResponse {
    return trustLadder()
  }
}
