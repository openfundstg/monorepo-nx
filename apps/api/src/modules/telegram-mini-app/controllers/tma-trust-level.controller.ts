import { Controller, Get } from '@nestjs/common'
import { TrustLevel } from '@transacto/contracts'
import type { TrustLevelLadderResponse } from '@transacto/contracts'
import { Public } from 'src/modules/auth'
import { TRUST_LEVELS } from 'src/shared/constants'

/** Cheapest rung first, which is the order the Mini App renders them in. */
const LADDER: readonly TrustLevel[] = [TrustLevel.NEWBIE, TrustLevel.EXPERIENCED, TrustLevel.PRO]

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
    return {
      levels: LADDER.map((level) => ({
        level,
        minTurnover: TRUST_LEVELS[level].minTurnover,
        maxParallelOrders: TRUST_LEVELS[level].maxParallelOrders
      }))
    }
  }
}
