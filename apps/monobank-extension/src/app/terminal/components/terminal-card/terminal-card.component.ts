import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { BankProvider, SaleRemainderPolicy, TerminalSource } from '@transacto/contracts';
import { KopecksPipe } from '../../../shared/pipes/kopecks.pipe';
import { TerminalLoaderService } from '../../services/terminal-loader.service';
import { Polling } from '../../enums/polling.enum';
import type { Terminal } from '../../interfaces/terminal.interface';

/** Progress-bar colours per bank: [filled, empty]. */
const PROVIDER_GRADIENT: Record<BankProvider, readonly [string, string]> = {
  [BankProvider.PRIVAT]: ['#1b7e4a', '#0d3b23'],
  [BankProvider.PUMB]: ['#b93144', '#78202c'],
  [BankProvider.MONO]: ['#323234', '#141415'],
  // NovaPay's purple, darkened for the unfilled half like the three above.
  [BankProvider.NOVAPAY]: ['#690dd3', '#33076a'],
};

@Component({
  selector: 'app-terminal-card',
  imports: [DatePipe, TranslatePipe, KopecksPipe],
  templateUrl: './terminal-card.component.html',
  styleUrl: './terminal-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TerminalCardComponent implements OnInit, OnDestroy {
  readonly terminal = input.required<Terminal>();
  readonly hasAlert = input<boolean>(false);
  readonly isExpanded = input<boolean>(false);
  readonly toggle = output<void>();

  private readonly terminalLoader = inject(TerminalLoaderService);

  readonly isSyncing = signal<boolean>(false);
  readonly isPollingActive = signal<boolean>(false);

  /** How full the jar is, 0–100. A terminal with no goal is all-or-nothing. */
  readonly percent = computed(() => {
    const term = this.terminal();
    // No balance on record fills nothing, rather than filling the bar entirely
    // via the no-goal branch below.
    if (term.balanceKnown === false) return 0;
    if (!term.goal || term.goal <= 0) return term.balance === 0 ? 0 : 100;

    return Math.min((term.balance / term.goal) * 100, 100);
  });

  readonly backgroundGradient = computed(() => {
    const [filled, empty] =
      PROVIDER_GRADIENT[this.terminal().bankProvider ?? BankProvider.MONO] ??
      PROVIDER_GRADIENT[BankProvider.MONO];

    return `linear-gradient(to right, ${filled} ${this.percent()}%, ${empty} ${this.percent()}%)`;
  });

  /** Terminals the Mini App created for its own sales carry the TG flag. */
  readonly isTmaCreated = computed(() => this.terminal().source === TerminalSource.TMA);

  /**
   * Whether this jar's order gives back a remainder no payment can cover.
   *
   * What it means to a trader is whether the jar will ever ask them for
   * anything. One that waits for the full amount raises "almost full" within
   * one order of its goal, and the last stretch is theirs to pay in by hand;
   * one that refunds its remainder closes itself and never asks.
   *
   * Absent on a terminal the trader created themselves, which has no sale
   * behind it and makes no promise either way — hence the corner flag
   * only says anything at all on a Mini App jar.
   */
  readonly refundsRemainder = computed(
    () => this.terminal().remainderPolicy === SaleRemainderPolicy.REFUND_TO_BALANCE,
  );

  /**
   * What the corner flag says it is.
   *
   * The flag keeps reading `TG` in both cases and changes colour instead. A
   * glyph was tried and measured: at 0.8rem, rotated 45°, an arrow is a smudge
   * — legible only when the card is blown up three times, which is not how
   * anyone reads a dashboard. Colour survives that downscale; a hairline arrow
   * does not.
   *
   * Colour alone cannot *teach* the distinction, so it does not carry it alone:
   * the tooltip says it in words, and the one kind that behaves unexpectedly
   * gets a legible label in the row below — see `showsRemainderChip`.
   */
  readonly tmaBadgeTitleKey = computed(() =>
    this.refundsRemainder() ? 'DASHBOARD.SOURCE_TMA_REFUND' : 'DASHBOARD.SOURCE_TMA',
  );

  /**
   * Whether to spell the behaviour out under the jar's goal.
   *
   * **Only the refunding kind gets a label, and that asymmetry is the point.**
   * A jar that waits for its full amount behaves exactly like every terminal
   * the trader created themselves — it fills up, it warns when it is nearly
   * full, somebody pays the last stretch in. Labelling that would put a mark on
   * the majority of cards to state the default. The self-closing jar is the one
   * that breaks the expectation, so it is the one worth a word.
   */
  readonly showsRemainderChip = computed(() => this.isTmaCreated() && this.refundsRemainder());

  /**
   * A jar whose Mini App user has asked to stop, with payments still
   * outstanding.
   *
   * It is deliberately still here rather than gone: Transacto routes nobody new
   * to it, but a payer already holding an order can still pay, so the jar can
   * still receive and the trader has to be able to see that. Dropping the card
   * at the moment the user tapped stop would hide live money.
   *
   * `=== false` rather than falsy: the field is absent on a terminal loaded
   * from a payload older than it, and absent means "routing normally".
   */
  readonly isWindingDown = computed(() => this.terminal().acceptingOrders === false);

  /**
   * A switched-off jar, reached through the search rather than the live list.
   *
   * `enabled` is only ever `false` on a search result — the dashboard payload
   * carries live terminals — so `!== false` rather than falsy keeps a card with
   * the field absent out of this.
   */
  readonly isArchived = computed(() => this.terminal().enabled === false);

  /**
   * Whether the balance on the card means anything.
   *
   * A terminal switched off before the figures started being persisted has none
   * stored anywhere, and its `balance` is a placeholder zero. Rendering that as
   * "₴0.00" would state that the jar is empty, which is a different claim from
   * not knowing what is in it.
   */
  readonly hasKnownBalance = computed(() => this.terminal().balanceKnown !== false);

  readonly formattedPendingSum = computed(() => {
    const pending = this.terminal().pendingOrdersSum;
    return pending ? new KopecksPipe('uk-UA').transform(pending, 'currency') : '';
  });

  private timer?: ReturnType<typeof setInterval>;

  constructor() {
    effect(() => {
      this.terminal();
      this.updatePollingStatus();
    });
  }

  ngOnInit(): void {
    this.updatePollingStatus();
    // Freshness decays with wall-clock time, not with state changes, so the
    // indicator has to be re-evaluated on a timer rather than reactively.
    this.timer = setInterval(() => this.updatePollingStatus(), Polling.TICK_MS);
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  onToggle(): void {
    this.toggle.emit();
  }

  openHistoryTab(e: Event): void {
    e.stopPropagation();
    const { cardId } = this.terminal();
    if (!cardId) return;

    chrome.windows.create({
      url: chrome.runtime.getURL(`index.html#/history/${cardId}`),
      type: 'popup',
      width: 1000,
      height: 800,
    });
  }

  openTerminalLink(e: Event): void {
    e.stopPropagation();
    const { url } = this.terminal();
    if (url) chrome.tabs.create({ url });
  }

  async syncTerminal(e: Event): Promise<void> {
    e.stopPropagation();
    const { terminalId } = this.terminal();
    if (!terminalId) return;

    this.isSyncing.set(true);
    try {
      await this.terminalLoader.syncTerminal(terminalId);
    } finally {
      this.isSyncing.set(false);
    }
  }

  private updatePollingStatus(): void {
    const term = this.terminal();
    if (!term?.enabled || !term?.lastUpdated) {
      this.isPollingActive.set(false);
      return;
    }

    const age = Date.now() - new Date(term.lastUpdated).getTime();
    this.isPollingActive.set(age <= Polling.STALE_AFTER_MS);
  }
}
