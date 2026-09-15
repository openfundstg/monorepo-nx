import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { DatePipe, NgClass } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { TerminalService } from '../../../terminal/services/terminal.service';
import { AlertsService } from '../../services/alerts.service';
import { formatAlertMetadata, type FormattedAlert } from '../../utils/alert.utils';

/** Kopecks per hryvnia — the API speaks kopecks, the force-match form speaks UAH. */
const KOPECKS_PER_UAH = 100;

@Component({
  selector: 'app-terminal-alerts',
  imports: [NgClass, DatePipe, TranslatePipe, FormsModule],
  templateUrl: './terminal-alerts.component.html',
  styleUrl: './terminal-alerts.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TerminalAlertsComponent {
  readonly terminalId = input.required<number>();

  readonly terminalService = inject(TerminalService);
  private readonly alertsService = inject(AlertsService);
  private readonly translateService = inject(TranslateService);

  readonly activeForceMatchAlertId = signal<string | null>(null);
  forceMatchData = { orderId: null as number | null, amount: null as number | null };

  /**
   * Display copies, with amounts rendered as localised strings.
   *
   * Every action below deliberately re-reads the *unformatted* alert from the
   * store: the amounts here are strings like "1 234,56" and would be useless
   * as request payloads.
   */
  readonly formattedAlerts = computed(() =>
    formatAlertMetadata(
      this.terminalService.recentAlerts().filter((a) => a.terminalId === this.terminalId()),
    ),
  );

  async markAsRead(alert: FormattedAlert): Promise<void> {
    const id = alert.id || alert._id;
    if (alert.isRead || !id) return;

    // Optimistic: the badge clears immediately, and a failed call only means
    // the alert reappears on the next dashboard load.
    this.terminalService.markAlertAsRead(id);
    if (alert.terminalId) this.terminalService.checkAndRemoveDisabledTerminal(alert.terminalId);

    await this.alertsService.markAsRead(id);
  }

  async acknowledgeAlert(alertId: string | undefined, e: Event): Promise<void> {
    e.stopPropagation();
    if (!alertId) return;

    await this.alertsService.acknowledge(alertId);
  }

  async moveToBox(alert: FormattedAlert, e: Event): Promise<void> {
    e.stopPropagation();
    const alertId = alert.id || alert._id;
    if (!alertId) return;

    const comment = window.prompt(this.translateService.instant('ALERTS.MOVE_TO_BOX_PROMPT'));
    if (comment === null) return; // User cancelled

    const amount = this.originalAmountKopecks(alertId);
    await this.alertsService.moveToBox(alertId, Number(amount), comment);
  }

  startForceMatch(alert: FormattedAlert, e: Event): void {
    e.stopPropagation();
    const alertId = alert.id || alert._id;
    if (!alertId) return;

    const amountKopecks = this.originalAmountKopecks(alertId);

    this.forceMatchData = {
      orderId: null,
      amount: amountKopecks ? Number(amountKopecks) / KOPECKS_PER_UAH : null,
    };
    this.activeForceMatchAlertId.set(alertId);
  }

  cancelForceMatch(e: Event): void {
    e.stopPropagation();
    this.activeForceMatchAlertId.set(null);
  }

  async submitForceMatch(alertId: string | undefined, e: Event): Promise<void> {
    e.stopPropagation();
    if (!alertId) return;

    const { orderId, amount } = this.forceMatchData;

    if (!orderId || isNaN(orderId) || orderId <= 0) {
      alert(this.translateService.instant('ALERTS.INVALID_ORDER_ID'));
      return;
    }

    if (!amount || isNaN(amount) || amount <= 0) {
      alert(this.translateService.instant('ALERTS.INVALID_AMOUNT'));
      return;
    }

    await this.alertsService.forceMatch(alertId, orderId, Math.round(amount * KOPECKS_PER_UAH));
    this.activeForceMatchAlertId.set(null);
  }

  /**
   * Pulls the numeric amount straight from the store.
   *
   * Falls back to `metadata.amount`, and re-parses the localised form ("1 234,56")
   * for alerts whose amount only ever existed as a formatted string.
   */
  private originalAmountKopecks(alertId: string): number | undefined {
    const original = this.terminalService
      .recentAlerts()
      .find((a) => (a.id || a._id) === alertId);

    const raw = original?.amount ?? original?.metadata?.['amount'];

    if (typeof raw === 'string') {
      return Math.round(parseFloat(raw.replace(',', '.')) * KOPECKS_PER_UAH);
    }

    return typeof raw === 'number' ? raw : undefined;
  }
}
