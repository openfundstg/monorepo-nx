import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { SaleEvidence, type AdminSaleHistoryItem } from '@transacto/contracts';
import { DateTimePipe, UahPipe } from '../../pipes';
import { evidenceTone } from '../../utils';
import { StatusChipComponent } from '../status-chip/status-chip.component';

/** One entry, with the one thing about it the row has to answer. */
interface TimelineRow {
  readonly entry: AdminSaleHistoryItem;
  /**
   * Whether this is somebody's claim that nothing has backed up yet.
   *
   * The state the whole screen exists to make visible: a card sale has no
   * witness of its own, so an uncorroborated assertion is all there is until a
   * document covers the moment it was made.
   */
  readonly unproven: boolean;
}

/**
 * A sale's story, and who says so.
 *
 * **The card variant's answer to the jar's scraping history.** A jar keeps its
 * history by being watched — the scraper polls a balance, and every row is an
 * observation of money that is either there or not. Nobody can poll a seller's
 * own card, so this timeline is not a record of observations at all: it is a
 * record of assertions and of what later corroborated them.
 *
 * That is why `evidence` is a column rather than a detail. "₴1 428 reached this
 * card" is a completely different fact depending on whether a seller tapped yes
 * or a bank signed a document, and an operator must never have to guess which
 * they are reading.
 */
@Component({
  selector: 'app-sale-timeline',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    MatIconModule,
    MatTooltipModule,
    TranslatePipe,
    StatusChipComponent,
    UahPipe,
    DateTimePipe,
  ],
  templateUrl: './sale-timeline.component.html',
  styleUrl: './sale-timeline.component.scss',
})
export class SaleTimelineComponent {
  readonly entries = input.required<readonly AdminSaleHistoryItem[]>();
  /** Where a document opens. Supplied by the page, which owns the link. */
  readonly documentUrl = input<((statementId: string) => string) | null>(null);

  protected readonly evidenceTone = evidenceTone;

  readonly rows = computed<readonly TimelineRow[]>(() =>
    this.entries().map((entry) => ({
      entry,
      // A claim, and nothing has covered it. `UPSTREAM` and `SYSTEM` entries are
      // not claims at all — Transacto's own facts and a clock — so they are
      // never marked unproven, however little a statement says about them.
      unproven: entry.evidence === SaleEvidence.SELLER && entry.corroboratedBy === null,
    })),
  );

  fileUrl(statementId: string): string | null {
    const build = this.documentUrl();

    return build ? build(statementId) : null;
  }
}
