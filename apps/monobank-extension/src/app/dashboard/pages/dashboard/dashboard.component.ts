import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core'
import { toObservable, toSignal } from '@angular/core/rxjs-interop'
import { FormsModule } from '@angular/forms'
import { TranslatePipe } from '@ngx-translate/core'
import { catchError, debounceTime, distinctUntilChanged, map, of, startWith, switchMap } from 'rxjs'
import { TerminalSource } from '@transacto/contracts'
import { TerminalService } from '../../../terminal/services/terminal.service'
import { TerminalLoaderService } from '../../../terminal/services/terminal-loader.service'
import { TerminalCardComponent } from '../../../terminal/components/terminal-card/terminal-card.component'
import { TerminalAlertsComponent } from '../../components/terminal-alerts/terminal-alerts.component'
import { TerminalFilter } from '../../../terminal/enums/terminal-filter.enum'
import { TerminalSearchBounds } from '../../../terminal/constants/terminal-search.const'
import type { Terminal } from '../../../terminal/interfaces/terminal.interface'

/** Fields the search box looks at locally, before the server answers. */
const searchableText = (terminal: Terminal): string =>
  [
    terminal.terminalName,
    terminal.sendId,
    terminal.bankProvider,
    terminal.cardId,
    terminal.terminalId
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

const matchesFilter = (terminal: Terminal, filter: TerminalFilter): boolean => {
  if (filter === TerminalFilter.ALL) return true

  const isTma = terminal.source === TerminalSource.TMA
  return filter === TerminalFilter.TMA ? isTma : !isTma
}

/** What one round of the network search produced. */
interface RemoteSearch {
  readonly terminals: readonly Terminal[]
  /** How many matched server-side, which may exceed what was returned. */
  readonly total: number
  readonly failed: boolean
}

const IDLE: RemoteSearch = { terminals: [], total: 0, failed: false }

@Component({
  selector: 'app-dashboard',
  imports: [FormsModule, TranslatePipe, TerminalCardComponent, TerminalAlertsComponent],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DashboardComponent {
  readonly terminalService = inject(TerminalService)
  private readonly terminalLoader = inject(TerminalLoaderService)

  /** Exposed so the template compares against enum members, not literals. */
  protected readonly TerminalFilter = TerminalFilter

  readonly filter = signal<TerminalFilter>(TerminalFilter.ALL)
  readonly search = signal<string>('')

  /**
   * The same term, once it has settled and is long enough to be worth a request.
   *
   * Below the minimum length a query matches most of an account and the ranking
   * has nothing to work with, so the server rejects it — asking would be a
   * guaranteed 400 on the second keystroke of every search.
   */
  private readonly settledTerm = toSignal(
    toObservable(this.search).pipe(
      map((term) => term.trim()),
      debounceTime(TerminalSearchBounds.DEBOUNCE_MS),
      // Short terms collapse to the empty string *before* the distinctness
      // check, so typing through "п", "пр", "про" produces one idle emission
      // rather than one per keystroke.
      map((term) => (term.length >= TerminalSearchBounds.MIN_TERM_LENGTH ? term : '')),
      distinctUntilChanged()
    ),
    { initialValue: '' }
  )

  /**
   * Terminals the server found, including ones the dashboard never shows.
   *
   * A failure is carried rather than thrown: the local list still works
   * offline, and the only honest thing to do is keep showing it while saying
   * the archive could not be reached.
   */
  private readonly remote = toSignal(
    toObservable(this.settledTerm).pipe(
      switchMap((term) => {
        if (!term) return of(IDLE)

        return this.terminalLoader.searchTerminals(term).then(
          (result) => ({ ...result, failed: false }),
          () => ({ ...IDLE, failed: true })
        )
      }),
      catchError(() => of({ ...IDLE, failed: true })),
      startWith(IDLE)
    ),
    { initialValue: IDLE }
  )

  readonly isSearching = computed(() => {
    const term = this.search().trim()
    if (term.length < TerminalSearchBounds.MIN_TERM_LENGTH) return false

    // The debounce has not caught up yet, so what is on screen is still the
    // local list for the previous term.
    return this.settledTerm() !== term
  })

  readonly searchFailed = computed(() => this.remote().failed)

  /** How many matched server-side beyond the page being rendered. */
  readonly hiddenMatchCount = computed(() =>
    Math.max(this.remote().total - this.remote().terminals.length, 0)
  )

  /**
   * What the grid renders.
   *
   * With no search term this is the live dashboard, unchanged. With one, it is
   * **only** what matched — the server's list, in the server's order, since
   * that is where the exact-name-first ranking lives.
   *
   * A terminal that is both a search hit and already in the store is rendered
   * from the store copy: that one is being kept current by socket events, and
   * the search response is a snapshot taken when the request was made.
   */
  readonly terminals = computed(() => {
    const filter = this.filter()
    const term = this.search().trim().toLowerCase()
    const live = this.terminalService.terminals()

    if (!term) return live.filter((terminal) => matchesFilter(terminal, filter))

    const localMatches = live
      .filter((terminal) => matchesFilter(terminal, filter))
      .filter((terminal) => searchableText(terminal).includes(term))

    const found = this.remote().terminals
    // Nothing back from the server yet — either still typing, or it failed.
    // The local matches are a strict subset of what the server will return, so
    // showing them is a partial answer rather than a wrong one.
    if (!found.length) return localMatches

    const liveById = new Map(live.map((terminal) => [terminal.terminalId, terminal]))

    return found
      .map((hit) => {
        const current = liveById.get(hit.terminalId)
        return current ? { ...hit, ...current } : hit
      })
      .filter((terminal) => matchesFilter(terminal, filter))
  })

  /** Drives the "nothing matches" message, which differs from "no terminals". */
  readonly hasTerminals = computed(() => this.terminalService.terminals().length > 0)

  readonly tmaCount = computed(
    () => this.terminalService.terminals().filter((t) => t.source === TerminalSource.TMA).length
  )

  /** How many of the rendered results are switched-off jars. */
  readonly archivedCount = computed(
    () => this.terminals().filter((terminal) => terminal.enabled === false).length
  )

  setFilter(filter: TerminalFilter): void {
    this.filter.set(filter)
  }

  clearSearch(): void {
    this.search.set('')
  }

  hasActiveAlert(terminalId: number | undefined): boolean {
    if (!terminalId) return false
    return this.terminalService.recentAlerts().some((a) => a.terminalId === terminalId)
  }

  /** Cards with an alert start expanded, unless the trader has said otherwise. */
  isTerminalExpanded(terminalId: number | undefined): boolean {
    if (!terminalId) return false

    const explicit = this.terminalService.expandedTerminals()[terminalId]
    return explicit ?? this.hasActiveAlert(terminalId)
  }

  toggleTerminal(terminalId: number | undefined): void {
    if (!terminalId) return
    this.terminalService.toggleTerminalExpanded(terminalId)
  }
}
