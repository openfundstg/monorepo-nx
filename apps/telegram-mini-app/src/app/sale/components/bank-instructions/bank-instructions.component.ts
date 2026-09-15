import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { BANK_URL_KEYWORDS, BankProvider } from '@transacto/contracts';
import { TmaService } from '../../../auth/services/tma.service';
import { GuidePreferenceService } from '../../services/guide-preference.service';
import { UahPipe } from '../../../shared/pipes/uah.pipe';
import { BANK_GUIDE } from '../../constants/bank-guide.const';

/**
 * The setup guide for whichever bank is selected on the create form.
 *
 * Open by default. The one-line hint this replaces was not enough to get a
 * usable link out of any of the three banks — each needs a different artefact
 * (a stream-widget link, an envelope link, a browser address bar) — so the
 * steps are the point of the screen, not an optional aside.
 *
 * Screenshots are referenced whether or not the file exists yet: a missing
 * image renders as a labelled placeholder rather than a broken icon, so the
 * guide is usable before the pictures are added and needs no code change when
 * they are.
 */
@Component({
  selector: 'app-bank-instructions',
  imports: [TranslatePipe, UahPipe],
  templateUrl: './bank-instructions.component.html',
  styleUrl: './bank-instructions.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BankInstructionsComponent {
  private readonly tma = inject(TmaService);
  private readonly preference = inject(GuidePreferenceService);

  readonly bank = input.required<BankProvider>();

  /**
   * What the jar's target has to be, in UAH kopecks — the order total including
   * profit.
   *
   * Rendered as its own callout rather than buried in a step, because the
   * backend blocks the order and the terminal outright when the jar disagrees.
   * Showing the exact figure to type is the difference between a rule the user
   * can follow and one they can only fail.
   */
  readonly targetAmount = input.required<number>();

  /**
   * Open or collapsed, remembered between visits.
   *
   * Held by the service rather than here so the choice survives this component
   * being destroyed — which happens on every navigation away from the form.
   */
  readonly expanded = this.preference.expanded;

  readonly guide = computed(() => BANK_GUIDE[this.bank()]);

  /**
   * The substring the pasted link must contain, straight from the contract the
   * backend validates against — never a second copy of those hostnames.
   */
  readonly requiredHost = computed(() => BANK_URL_KEYWORDS[this.bank()]);

  /**
   * Screenshots that failed to load, so their slot can fall back to a
   * placeholder. Tracked by path rather than by index because the set has to
   * survive the user switching banks and back.
   */
  private readonly missingImages = signal<ReadonlySet<string>>(new Set());

  toggle(): void {
    this.tma.hapticFeedback('light');
    // The signal flips immediately; persisting is the part that awaits.
    void this.preference.toggle();
  }

  isMissing(image: string): boolean {
    return this.missingImages().has(image);
  }

  onImageError(image: string): void {
    this.missingImages.update((missing) => new Set(missing).add(image));
  }
}
