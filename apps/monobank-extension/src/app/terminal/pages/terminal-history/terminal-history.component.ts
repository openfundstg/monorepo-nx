import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  input,
  signal
} from '@angular/core'
import { DatePipe } from '@angular/common'
import { Subscription } from 'rxjs'
import { TranslatePipe } from '@ngx-translate/core'
import { WsEventNames, type TerminalHistoryUpdatedDto } from '@transacto/contracts'
import { HistoryTableComponent, processHistoryLog, type HistoryLog } from '@transacto/history-table'
import { SocketService } from '../../../core/services/socket.service'
import { TerminalService } from '../../services/terminal.service'
import { TerminalLoaderService } from '../../services/terminal-loader.service'
import { Polling } from '../../enums/polling.enum'

/** How long the sync spinner stays up after the request returns. */
const SYNC_FEEDBACK_MS = 1000

@Component({
  selector: 'app-terminal-history',
  imports: [DatePipe, TranslatePipe, HistoryTableComponent],
  templateUrl: './terminal-history.component.html',
  styleUrl: './terminal-history.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class TerminalHistoryComponent implements OnInit, OnDestroy {
  readonly cardId = input.required<number>()
  readonly terminalId = input.required<string>()

  readonly logs = signal<HistoryLog[]>([])
  readonly loading = signal<boolean>(true)
  readonly error = signal<string | null>(null)

  readonly terminalService = inject(TerminalService)
  private readonly terminalLoader = inject(TerminalLoaderService)
  private readonly socketService = inject(SocketService)

  readonly currentTerminal = computed(() => {
    const cid = Number(this.cardId())
    return this.terminalService.terminals().find((t) => t.cardId === cid)
  })

  readonly isSyncing = signal<boolean>(false)
  readonly isPollingActive = signal<boolean>(false)

  private pollingTimer?: ReturnType<typeof setInterval>
  private historySub?: Subscription

  ngOnInit() {
    void this.fetchHistory()

    this.updatePollingStatus()
    this.pollingTimer = setInterval(() => this.updatePollingStatus(), Polling.TICK_MS)
    this.listenToHistoryUpdates()
  }

  ngOnDestroy() {
    this.historySub?.unsubscribe()
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer)
    }
  }

  private updatePollingStatus() {
    const term = this.currentTerminal()
    if (!term?.enabled || !term?.lastUpdated) {
      this.isPollingActive.set(false)
      return
    }
    const diff = Date.now() - new Date(term.lastUpdated).getTime()
    this.isPollingActive.set(diff <= Polling.STALE_AFTER_MS)
  }

  async syncTerminal(e: Event) {
    e.stopPropagation()
    const term = this.currentTerminal()
    if (this.isSyncing() || !term?.terminalId) return

    this.isSyncing.set(true)
    try {
      await this.terminalLoader.syncTerminal(term.terminalId)
    } finally {
      setTimeout(() => this.isSyncing.set(false), SYNC_FEEDBACK_MS)
    }
  }

  private async fetchHistory(): Promise<void> {
    this.loading.set(true)
    try {
      this.logs.set(await this.terminalLoader.loadHistory(this.cardId()))
    } catch (err) {
      console.error('Failed to load history', err)
      this.error.set('Could not load terminal history')
    } finally {
      this.loading.set(false)
    }
  }

  private listenToHistoryUpdates() {
    this.historySub = this.socketService
      .on<TerminalHistoryUpdatedDto>(WsEventNames.TERMINAL_HISTORY_UPDATED)
      .subscribe((update) => {
        // The backend needs to emit the FULL log object with cardId. We verify it belongs to this card.
        if (Number(update.cardId) === Number(this.cardId())) {
          const processed = processHistoryLog(update)
          processed.isNew = true
          this.logs.update((logs) => [processed, ...logs])
        }
      })
  }
}
