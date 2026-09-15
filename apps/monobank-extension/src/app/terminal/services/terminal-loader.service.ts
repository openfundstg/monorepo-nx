import { Injectable, inject } from '@angular/core'
import { firstValueFrom } from 'rxjs'
import type { BankProvider, TerminalSearchItem } from '@transacto/contracts'
import { TerminalService } from './terminal.service'
import { TerminalApiService, type DashboardTerminalRes } from './terminal.api.service'
import { processHistoryLog } from '@transacto/history-table'
import type { HistoryLog, Terminal, TerminalSearchResult } from '../interfaces/terminal.interface'

/**
 * Fills the store from REST, for everything the socket does not push.
 *
 * Kept apart from `TerminalService` because that one is an ngrx signal store —
 * it holds state and knows nothing about HTTP.
 */
@Injectable({ providedIn: 'root' })
export class TerminalLoaderService {
  private readonly api = inject(TerminalApiService)
  private readonly store = inject(TerminalService)

  /** One-shot hydration after login, before live events take over. */
  async hydrateInitialState(): Promise<void> {
    try {
      const response = await firstValueFrom(this.api.getDashboard())
      this.store.setInitialData((response.terminals || []).map(toTerminal), response.alerts || [])
    } catch (err) {
      console.error('Failed to hydrate initial state', err)
    }
  }

  async loadHistory(cardId: number): Promise<HistoryLog[]> {
    const response = await firstValueFrom(this.api.getHistory(cardId))
    return (response.history || []).map(processHistoryLog)
  }

  /**
   * Terminals matching a term, from the server, disabled ones included.
   *
   * Not written into the store. The store is the live dashboard — everything in
   * it is being polled and kept current by socket events — and dropping
   * archived jars into it would leave them there after the search is cleared,
   * with balances nothing will ever update. Search results are the caller's to
   * render and discard.
   *
   * The server's order is preserved: it ranks exact name matches first, and
   * re-sorting here would throw that away.
   */
  async searchTerminals(term: string, limit?: number): Promise<TerminalSearchResult> {
    const response = await firstValueFrom(this.api.searchTerminals(term, limit))

    return {
      terminals: (response.terminals || []).map(searchHitToTerminal),
      total: response.total ?? 0
    }
  }

  async syncTerminal(terminalId: number): Promise<boolean> {
    try {
      await firstValueFrom(this.api.sync(terminalId))
      return true
    } catch (err) {
      console.error('Failed to sync terminal', err)
      return false
    }
  }
}

/**
 * A dashboard row, or the `terminal.enabled` push, as one card.
 *
 * The two shapes are deliberately the same, and this is deliberately the only
 * place either becomes a `Terminal`. A live row and a reloaded one that were
 * mapped separately is exactly how they come to disagree — and the disagreement
 * only ever shows up in front of a trader.
 */
export const toTerminal = (row: DashboardTerminalRes): Terminal => ({
  terminalId: row.terminalId,
  cardId: row.cardId,
  sendId: row.sendId,
  terminalName: row.terminalName,
  bankProvider: row.bankProvider as BankProvider | undefined,
  source: row.source,
  url: row.url,
  balance: row.balance,
  goal: row.goal,
  hasPendingOrders: row.hasPendingOrders,
  acceptingOrders: row.acceptingOrders,
  pendingOrdersSum: row.pendingOrdersSum,
  enabled: row.enabled,
  remainderPolicy: row.remainderPolicy,
  balanceAt: row.balanceAt ? new Date(row.balanceAt) : undefined,
  status: 'ACTIVE',
  lastUpdated: row.updatedAt ? new Date(row.updatedAt) : undefined
})

/**
 * A search hit as the dashboard renders it.
 *
 * `balance` is nullable on the wire and not here, so an unknown balance becomes
 * a zero plus `balanceKnown: false` — the card needs a number for its progress
 * bar either way, and the flag is what stops that zero being read as an empty
 * jar.
 */
const searchHitToTerminal = (hit: TerminalSearchItem): Terminal => ({
  terminalId: hit.terminalId,
  cardId: hit.cardId,
  sendId: hit.sendId,
  terminalName: hit.terminalName,
  bankProvider: hit.bankProvider,
  source: hit.source,
  url: hit.url,
  balance: hit.balance ?? 0,
  balanceKnown: hit.balance !== null,
  goal: hit.goal ?? undefined,
  balanceAt: hit.balanceAt ? new Date(hit.balanceAt) : undefined,
  hasPendingOrders: hit.hasPendingOrders,
  acceptingOrders: hit.acceptingOrders,
  pendingOrdersSum: hit.pendingOrdersSum,
  enabled: hit.enabled,
  remainderPolicy: hit.remainderPolicy,
  status: 'ACTIVE'
})
