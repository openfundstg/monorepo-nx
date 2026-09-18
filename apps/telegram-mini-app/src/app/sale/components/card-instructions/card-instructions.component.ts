import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { TmaService } from '../../../auth/services/tma.service';
import { GuidePreferenceService } from '../../services/guide-preference.service';
import { UahPipe } from '../../../shared/pipes/uah.pipe';
import { CARD_GUIDE_STEP_KEYS } from '../../constants/sale-card-create.const';

/**
 * What a card sale actually asks of its seller, before they agree to it.
 *
 * The jar form's guide with a different subject. That form explains how to
 * produce an artefact; this one explains an obligation — the money arrives in
 * several payments, each one has to be answered, and a payment that is denied
 * has to be proven with a document. None of that is guessable from a form with
 * an amount and a card number on it.
 *
 * It replaces a always-open panel headed "how the money arrives". Collapsed by
 * the same remembered preference as the jar's guide, and for the same reason: a
 * seller on their fifth sale is being asked to scroll past an explanation they
 * have read four times.
 */
@Component({
  selector: 'app-card-instructions',
  imports: [TranslatePipe, UahPipe],
  templateUrl: './card-instructions.component.html',
  styleUrl: './card-instructions.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardInstructionsComponent {
  private readonly tma = inject(TmaService);
  private readonly preference = inject(GuidePreferenceService);

  /** The whole sale, in UAH kopecks — what the payments add up to. */
  readonly totalKopecks = input.required<number>();

  /** How many payments it will be split into, at most. */
  readonly orders = input.required<number>();

  /** The floor under each one, in UAH kopecks. */
  readonly perOrderKopecks = input.required<number>();

  /**
   * Open or collapsed, remembered between visits — and deliberately the *same*
   * preference the jar guide uses. It is one answer to one question ("do I want
   * the explanation?"), not one per screen.
   */
  readonly expanded = this.preference.expanded;

  protected readonly stepKeys = CARD_GUIDE_STEP_KEYS;

  toggle(): void {
    this.tma.hapticFeedback('light');
    // The signal flips immediately; persisting is the part that awaits.
    void this.preference.toggle();
  }
}
