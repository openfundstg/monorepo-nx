import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  linkedSignal,
  output,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import {
  FiatDepositWatchMode,
  KOPECKS_PER_UAH,
  type FiatDepositWatch,
  type SaveFiatDepositWatchReq,
} from '@transacto/contracts';

/**
 * Where a user leaves the range they are waiting for.
 *
 * The book is other traders' payouts and nobody here decides what is in it, so
 * on a night that offers ₴300 and ₴42 000 somebody who needs ₴7 000 has nothing
 * to do but keep re-opening the screen. This is the alternative, and it is the
 * one control on the top-up flow that promises something rather than taking
 * one: nothing is reserved, nothing is committed, and it can be cancelled from
 * the message it produces.
 *
 * **Whole hryvnia in, kopecks out.** People type `1000`, not `100000`, and the
 * whole product speaks kopecks — so the conversion happens here, once, at the
 * edge where the two meet.
 *
 * Presentational: it validates what it can see and reports a decision. Whether
 * the range is above this account's ceiling, or beneath the product's floor, is
 * the server's to answer, because only the server knows.
 */
@Component({
  selector: 'app-fiat-watch',
  imports: [TranslatePipe],
  templateUrl: './fiat-watch.modal.html',
  styleUrl: './fiat-watch.modal.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FiatWatchModal {
  /** The request being amended, or `null` when this is a new one. */
  readonly watch = input<FiatDepositWatch | null>(null);
  /** While the save is in flight: every control stops answering. */
  readonly busy = input(false);
  /** A refusal from the server, already translated. */
  readonly errorMsg = input('');

  readonly saved = output<SaveFiatDepositWatchReq>();
  readonly dismissed = output<void>();

  readonly Mode = FiatDepositWatchMode;

  /**
   * The bounds as typed, in **whole hryvnia** and as strings.
   *
   * Strings rather than numbers because an emptied field is `''`, and a number
   * input bound to a number signal turns that into `0` — which reads as a
   * deliberate "from ₴0" and enables the button on a form nobody filled in.
   *
   * `linkedSignal`, not `signal`, and the difference is the whole feature: a
   * field initialiser runs while the component is being constructed, which is
   * *before* Angular has set any input — so seeding from `this.watch()` there
   * reads the default and opens an empty form on top of a request the user
   * already made. This follows the input and stays locally writable, which is
   * exactly what a form pre-filled from a source needs.
   */
  readonly minInput = linkedSignal(() => wholeUah(this.watch()?.minAmountUah));
  readonly maxInput = linkedSignal(() => wholeUah(this.watch()?.maxAmountUah));
  readonly mode = linkedSignal(() => this.watch()?.mode ?? FiatDepositWatchMode.ALWAYS);

  private readonly minUah = computed(() => parseWholeUah(this.minInput()));
  private readonly maxUah = computed(() => parseWholeUah(this.maxInput()));

  /**
   * Whether the form describes a range at all.
   *
   * Deliberately only the two things visible from here: both bounds are real
   * numbers above zero, and the top is not below the bottom. Everything else is
   * the server's answer.
   */
  readonly valid = computed(() => {
    const min = this.minUah();
    const max = this.maxUah();

    return min !== null && max !== null && min > 0 && max >= min;
  });

  /**
   * Typed handlers rather than `$any($event.target).value` in the template.
   *
   * `$any` is the template's form of `any`, which this app bans everywhere
   * else; a cast in a two-line method costs the same and keeps the ban whole.
   */
  onMinInput(event: Event): void {
    this.minInput.set(valueOf(event));
  }

  onMaxInput(event: Event): void {
    this.maxInput.set(valueOf(event));
  }

  submit(): void {
    const min = this.minUah();
    const max = this.maxUah();
    if (!this.valid() || min === null || max === null || this.busy()) return;

    this.saved.emit({
      minAmountUah: min * KOPECKS_PER_UAH,
      maxAmountUah: max * KOPECKS_PER_UAH,
      mode: this.mode(),
    });
  }

  /** The backdrop cancels, except while a save is in flight. */
  onBackdrop(): void {
    if (!this.busy()) this.dismissed.emit();
  }
}

/** What a text field currently holds, from its own input event. */
const valueOf = (event: Event): string => (event.target as HTMLInputElement).value;

/** Kopecks → the whole-hryvnia string the field shows, or `''` for nothing. */
const wholeUah = (kopecks: number | undefined): string =>
  kopecks === undefined ? '' : String(Math.round(kopecks / KOPECKS_PER_UAH));

/**
 * A typed field → whole hryvnia, or `null` when it is not a usable number.
 *
 * `Number('')` is `0` and `Number(' ')` is `0`, both of which would pass a
 * `> 0` check on a field the user never filled in — so an empty string is
 * rejected before the conversion rather than after it.
 */
const parseWholeUah = (value: string): number | null => {
  const trimmed = value.trim();
  if (trimmed === '') return null;

  const parsed = Number(trimmed);

  return Number.isInteger(parsed) ? parsed : null;
};
