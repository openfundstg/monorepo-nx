import type { QueryFilter } from 'mongoose'
import { Injectable } from '@nestjs/common'
import { TerminalSource, type TerminalSearchItem, type TerminalSearchRes } from '@transacto/contracts'
import { TerminalDbService } from 'src/modules/repositories/terminal-db/services'
import type { Terminal } from 'src/modules/repositories/terminal-db/schemas'
import { OrderDbService } from 'src/modules/repositories/order-db/services'
import { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'
import { TerminalStateCacheService } from 'src/modules/bank-scraper'
import { BankProvider } from 'src/shared/constants/bank.constants'
import {
  containsRegex,
  escapeRegex,
  exactMatchRegex,
  extractSendId,
  extractTargetId,
  getBankProvider
} from 'src/shared/utils'
import { TerminalUrlResolverService } from 'src/modules/terminal'

/**
 * How many terminals may be ranked for one query.
 *
 * Ranking happens here rather than in Mongo — "exact name first" is not a sort
 * key — so the candidates have to be in memory. This is the ceiling on that,
 * well above any real account and far below anything that could hurt.
 */
const CANDIDATE_CAP = 200

/**
 * Where a hit matched, best first. The numbers are the sort order and nothing
 * else, so they are free to be renumbered as long as the order holds.
 */
enum MatchRank {
  /** The name, exactly. What the trader almost always means. */
  EXACT_NAME = 0,
  /** An id typed in full — card id, terminal id, or the bank's send id. */
  EXACT_ID = 1,
  NAME_PREFIX = 2,
  NAME_CONTAINS = 3,
  /** Matched somewhere else — inside the bank URL, typically. */
  OTHER = 4
}

/**
 * Finds a trader's terminals by name or id, **including disabled ones**.
 *
 * The dashboard deliberately shows only live jars, which leaves a trader with
 * no way back to one that has been switched off — to read its history, or to
 * see what it was last holding. This is that way back.
 *
 * Ranking is the point of the endpoint. A trader searching "Прокрутка 12" wants
 * that terminal and not the forty others whose names contain "Прокрутка", so an
 * exact name match outranks everything, then an id typed in full, then a prefix,
 * then a substring.
 */
@Injectable()
export class ExtensionTerminalSearchService {
  constructor(
    private readonly terminalDbService: TerminalDbService,
    private readonly orderDbService: OrderDbService,
    private readonly terminalStateCacheService: TerminalStateCacheService,
    private readonly terminalUrlResolverService: TerminalUrlResolverService,
    private readonly saleDbService: TmaSaleDbService
  ) {}

  async search(traderId: number, term: string, limit: number): Promise<TerminalSearchRes> {
    const filter = this.buildFilter(traderId, term)

    // The exact-name query is run separately rather than trusted to fall out of
    // the broad one. The broad query is capped and ordered by recency, so on a
    // large account the very terminal the trader named could be the row that
    // the cap dropped — the one result the endpoint exists to return.
    const [total, candidates, exactMatches] = await Promise.all([
      this.terminalDbService.count(filter),
      this.terminalDbService.findLimited(filter, CANDIDATE_CAP),
      this.terminalDbService.findLimited(
        { traderId, terminalName: exactMatchRegex(term) },
        limit
      )
    ])

    const ranked = this.rank(this.dedupe([...exactMatches, ...candidates]), term).slice(0, limit)

    return { terminals: await this.decorate(ranked), total }
  }

  /**
   * Everything the term could plausibly name.
   *
   * `cred3` is in the `$or` because it holds the bank URL, and the send id or
   * target id a trader copies out of their browser lives inside it — matching
   * it is what makes pasting a jar link work as a search.
   */
  private buildFilter(traderId: number, term: string): QueryFilter<Terminal> {
    const contains = containsRegex(term)
    const or: QueryFilter<Terminal>[] = [{ terminalName: contains }, { cred3: contains }]

    // Only when the whole term is digits: `Number('12abc')` is NaN, and a
    // partial number is not an id the trader could have meant.
    if (/^\d+$/.test(term)) {
      const asNumber = Number(term)
      if (Number.isSafeInteger(asNumber)) {
        or.push({ cardId: asNumber }, { terminalId: asNumber })
      }
    }

    return { traderId, $or: or }
  }

  private dedupe(terminals: readonly Terminal[]): Terminal[] {
    const byKey = new Map<string, Terminal>()

    // `traderId + cardId` rather than `terminalId`: that pair is the collection's
    // unique index, and a terminal stored before `terminalId` was populated has
    // none.
    for (const terminal of terminals) {
      byKey.set(`${terminal.traderId}:${terminal.cardId}`, terminal)
    }

    return [...byKey.values()]
  }

  private rank(terminals: readonly Terminal[], term: string): Terminal[] {
    const lowered = term.toLowerCase()

    return terminals
      .map((terminal) => ({ terminal, rank: this.rankOf(terminal, lowered) }))
      .sort((a, b) => {
        if (a.rank !== b.rank) return a.rank - b.rank

        // A live jar before a dead one at the same rank: a trader who typed an
        // ambiguous term is far likelier to want the one still running.
        if (a.terminal.enabled !== b.terminal.enabled) return a.terminal.enabled ? -1 : 1

        return (a.terminal.terminalName ?? '').localeCompare(b.terminal.terminalName ?? '')
      })
      .map((entry) => entry.terminal)
  }

  private rankOf(terminal: Terminal, loweredTerm: string): MatchRank {
    const name = (terminal.terminalName ?? '').toLowerCase()

    if (name === loweredTerm) return MatchRank.EXACT_NAME

    const sendId = extractSendId(terminal.cred3)
    const targetId = extractTargetId(terminal.cred3)
    const isExactId =
      String(terminal.cardId) === loweredTerm ||
      String(terminal.terminalId) === loweredTerm ||
      sendId?.toLowerCase() === loweredTerm ||
      targetId?.toLowerCase() === loweredTerm

    if (isExactId) return MatchRank.EXACT_ID
    if (name.startsWith(loweredTerm)) return MatchRank.NAME_PREFIX
    if (name.includes(loweredTerm)) return MatchRank.NAME_CONTAINS

    return MatchRank.OTHER
  }

  /**
   * Adds the money to the rows that survived ranking, and only to those.
   *
   * Deliberately after the slice: this is where the per-row Redis reads happen,
   * and doing it before would price a page of twenty at the cost of two hundred.
   */
  private async decorate(terminals: readonly Terminal[]): Promise<TerminalSearchItem[]> {
    const cardIds = terminals.map((terminal) => terminal.cardId)
    const [pendingOrders, remainderPolicies] = await Promise.all([
      this.orderDbService.getPendingOrdersForCards(cardIds),
      this.saleDbService.findRemainderPoliciesByCardIds(cardIds)
    ])

    const pendingByCard = pendingOrders.reduce<Map<number, number>>(
      (totals, order) => totals.set(order.cardId, (totals.get(order.cardId) ?? 0) + order.amount),
      new Map()
    )

    return Promise.all(
      terminals.map(async (terminal) => {
        // Redis holds the live figures for a jar being polled; the stored copy
        // is what is left for one that is not. Both can be missing — a terminal
        // disabled before those fields existed has neither — which is why the
        // contract types them nullable rather than defaulting them to zero. A
        // balance of "₴0.00" and "we do not know" are different statements.
        const state = await this.terminalStateCacheService.getCurrentState(terminal.terminalId)
        const balance = state?.current ?? terminal.lastBalance ?? null
        const goal = state?.goal ?? terminal.lastGoal ?? null
        const pendingOrdersSum = pendingByCard.get(terminal.cardId) ?? 0

        const bankProvider = getBankProvider(terminal.cred3) || BankProvider.MONO

        return {
          terminalId: terminal.terminalId,
          cardId: terminal.cardId,
          targetId: extractTargetId(terminal.cred3) ?? undefined,
          sendId: extractSendId(terminal.cred3) ?? undefined,
          terminalName: terminal.terminalName || 'Unknown',
          source: terminal.source ?? TerminalSource.TRANSACTO,
          bankProvider,
          url: this.terminalUrlResolverService.resolve(bankProvider, terminal.cred3) ?? undefined,
          balance,
          goal,
          // Live figures are current by definition; only the stored copy is
          // dated, and dating it is what stops a stale balance reading as now.
          balanceAt: state
            ? new Date().toISOString()
            : (terminal.lastBalanceAt?.toISOString() ?? undefined),
          hasPendingOrders: pendingOrdersSum > 0,
          pendingOrdersSum,
          enabled: terminal.enabled,
          // `?? true`: a `.lean()` read applies no schema default.
          acceptingOrders: terminal.acceptingOrders ?? true,
          remainderPolicy: remainderPolicies.get(terminal.cardId)
        }
      })
    )
  }
}
