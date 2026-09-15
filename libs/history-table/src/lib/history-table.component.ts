import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core'
import { DatePipe } from '@angular/common'
import { TranslatePipe, TranslateService } from '@ngx-translate/core'
import {
  OrderExecutionReason,
  OrderStatus,
  TerminalHistoryAlertType,
  type TerminalHistoryAlert,
  type TerminalHistoryOrderEvent
} from '@transacto/contracts'
import { HistoryAmountComponent } from './history-amount.component'
import { KopecksPipe } from './kopecks.pipe'
import { historyMovement, unrecognizedBalance } from './history.utils'
import type { HistoryLog, HistoryRow } from './history.interface'

/** Execution reasons that mean a human confirmed the order rather than a matcher. */
const MANUAL_REASONS: ReadonlySet<OrderExecutionReason> = new Set([
  OrderExecutionReason.EXTENSION,
  OrderExecutionReason.ADMIN_PANEL
])

/** Maps an order event onto its `HISTORY.ORDER.*` translation key. */
const orderEventKey = (order: TerminalHistoryOrderEvent): string => {
  if (order.status === OrderStatus.CANCELLED) return 'CANCELLED'
  if (order.status === OrderStatus.PENDING) return 'PENDING'
  if (order.status !== OrderStatus.EXECUTED) return 'DEFAULT'

  if (order.executionReason === OrderExecutionReason.FULL_MATCH) return 'FULL_MATCH'
  if (order.executionReason === OrderExecutionReason.FUZZY_MATCH) return 'FUZZY_MATCH'
  if (order.executionReason && MANUAL_REASONS.has(order.executionReason)) return 'MANUAL'

  return 'DEFAULT'
}

/**
 * The terminal history table, shared by the extension and the admin panel.
 *
 * **Presentational only.** It takes the rows and renders them; it fetches
 * nothing and subscribes to nothing. That is what lets one component serve a
 * trader looking at their own jar and an operator looking at anybody's — the
 * two load their rows over different sockets, from different endpoints, with
 * different credentials, and none of that belongs in a table.
 *
 * It renders **translation keys**, never sentences, and each consuming app
 * supplies them from its own dictionaries. A missing key renders as the key,
 * which is the feedback that gets it written.
 */
@Component({
  selector: 'lib-history-table',
  imports: [DatePipe, TranslatePipe, HistoryAmountComponent],
  templateUrl: './history-table.component.html',
  styleUrl: './history-table.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class HistoryTableComponent {
  /** Newest first — the movement arrows are measured against the row below. */
  readonly logs = input.required<readonly HistoryLog[]>()
  readonly loading = input(false)
  /** Already-translated, or `null`. The library renders it as given. */
  readonly error = input<string | null>(null)

  private readonly translate = inject(TranslateService)

  /** One instance, rather than a new pipe per row render. */
  private readonly kopecks = new KopecksPipe('uk-UA')

  /**
   * The rows, with every money column's movement worked out once.
   *
   * Replaces the three per-index methods the template used to call on each row
   * on every change detection. They were three implementations of one rule, and
   * the actual-balance column was not one of them at all — it trusted
   * `log.delta` from the server, which is written as a literal `0`, so that
   * column never showed an arrow while the other two did.
   */
  readonly rows = computed<HistoryRow[]>(() => {
    const logList = this.logs()

    return logList.map((log, index) => {
      const previous: HistoryLog | undefined = logList[index + 1]
      const unrecognized = unrecognizedBalance(log)

      return {
        log,
        balance: log.balance,
        balanceDelta: historyMovement(log.balance, previous?.balance),
        expectedBalance: log.expectedBalance,
        expectedDelta: historyMovement(log.expectedBalance, previous?.expectedBalance),
        unrecognized,
        unrecognizedDelta: historyMovement(unrecognized, unrecognizedBalance(previous))
      }
    })
  })

  /**
   * The alert type is the translation key; its details are the parameters.
   * No switch is needed — a new alert type is a new entry in the i18n files.
   */
  getAlertTooltip(alert: TerminalHistoryAlert): string {
    return this.translate.instant(`ALERTS.${alert.type}_DESC`, alert.details)
  }

  getEventBadgeClass(order: TerminalHistoryOrderEvent): string {
    if (order.status === OrderStatus.CANCELLED) return 'badge-red'
    if (order.status === OrderStatus.PENDING) return 'badge-blue'
    if (order.status === OrderStatus.EXECUTED) {
      if (order.executionReason === OrderExecutionReason.FULL_MATCH) return 'badge-light-green'
      if (
        order.executionReason === OrderExecutionReason.FUZZY_MATCH ||
        order.executionReason === OrderExecutionReason.EXTENSION ||
        order.executionReason === OrderExecutionReason.ADMIN_PANEL
      )
        return 'badge-green'
    }
    return 'badge-gray'
  }

  getAlertBadgeClass(alert: TerminalHistoryAlert): string {
    // Neither of these is an alert. They share the channel because the history
    // has one place for "something happened that was not an order changing
    // state", and they are the two entries in it that report good news.
    if (
      alert.type === TerminalHistoryAlertType.ALERT_RESOLVED ||
      alert.type === TerminalHistoryAlertType.SALE_COMPLETED
    )
      return 'badge-green'
    if (
      alert.type === TerminalHistoryAlertType.UNRECOGNIZED_DEPOSIT ||
      alert.type === TerminalHistoryAlertType.AMBIGUOUS_DEPOSIT ||
      alert.type === TerminalHistoryAlertType.SAFE_TRANSFER
    )
      return 'badge-yellow'
    if (
      alert.type === TerminalHistoryAlertType.FRAUD ||
      alert.type === TerminalHistoryAlertType.FRAUD_SUSPICION
    )
      return 'badge-red'
    return 'badge-gray'
  }

  /**
   * Label for an order event.
   *
   * The status (and, for EXECUTED, the execution reason) picks the key; the
   * order supplies the parameters. Nothing user-facing is written here, so the
   * row reads correctly in every language the consuming app ships.
   */
  getEventBadgeText(order: TerminalHistoryOrderEvent): string {
    return this.translate.instant(`HISTORY.ORDER.${orderEventKey(order)}`, {
      orderId: order.orderId,
      amount: this.kopecks.transform(order.amount, 'currency')
    })
  }

  /**
   * Label for a history alert.
   *
   * The amount is appended rather than interpolated because it is optional, and
   * a translation cannot express "only if present" — parentheses around a
   * number are punctuation, not language.
   */
  getAlertBadgeText(alert: TerminalHistoryAlert): string {
    const context = (alert.details ?? {}) as Record<string, unknown>
    const amount =
      typeof context['amount'] === 'number'
        ? this.kopecks.transform(context['amount'], 'currency')
        : ''

    let text = this.translate.instant(`HISTORY.ALERT.${alert.type}`)
    if (amount) text += ` (${amount})`

    if (alert.type === TerminalHistoryAlertType.SAFE_TRANSFER && context['comment']) {
      text += this.translate.instant('HISTORY.ALERT.SAFE_TRANSFER_COMMENT', context)
    }

    if (alert.type === TerminalHistoryAlertType.UNRECOGNIZED_DEPOSIT) {
      // Never emitted by the backend today — see the extension REFACTORING.md
      if (context['reason'] === 'FUZZY_LIMIT_EXCEEDED') {
        text += this.translate.instant('HISTORY.ALERT.FUZZY_LIMIT_EXCEEDED')
      }
    }

    if (alert.type === TerminalHistoryAlertType.AMBIGUOUS_DEPOSIT) {
      text += this.translate.instant('HISTORY.ALERT.AMBIGUOUS_COMBINATIONS', {
        combinationsCount: context['combinationsCount'] ?? 0
      })
    }

    return text
  }
}
