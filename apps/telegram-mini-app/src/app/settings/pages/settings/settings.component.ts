import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  inject,
  linkedSignal,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { FiatDepositWatchMode } from '@transacto/contracts';
import type { FiatDepositWatch } from '@transacto/contracts';
import { TranslatePipe } from '@ngx-translate/core';
import { LogoComponent } from '../../../shared/components/logo/logo.component';
import { AppLanguage } from '../../../shared/enums/app-language.enum';
import { LanguageService } from '../../../shared/services/language.service';
import { TmaService } from '../../../auth/services/tma.service';
import { userActions } from '../../../user/store/user.actions';
import { selectProfile } from '../../../user/store/user.selectors';
import { ReferralService } from '../../../referral/services/referral.service';
import { FiatDepositService } from '../../../deposit/services/fiat-deposit.service';
import { OnboardingTourService } from '../../../onboarding/services/onboarding-tour.service';
import { formatUahWhole } from '../../../shared/utils/format.util';

/** How long the "saved" confirmation stays up after a switch. */
const SAVED_HINT_MS = 2_000;

/** Where the tour lives: every step but the first points at something on the dashboard. */
const HOME_ROUTE = '/';

@Component({
  selector: 'app-settings',
  imports: [TranslatePipe, LogoComponent],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsComponent implements OnInit, OnDestroy {
  private readonly languageService = inject(LanguageService);
  private readonly tma = inject(TmaService);
  private readonly store = inject(Store);
  private readonly referralService = inject(ReferralService);
  private readonly fiatDeposits = inject(FiatDepositService);
  private readonly tour = inject(OnboardingTourService);
  private readonly router = inject(Router);

  private readonly profile = this.store.selectSignal(selectProfile);

  readonly languages = this.languageService.languages;
  readonly current = this.languageService.current;
  readonly saved = signal(false);

  /**
   * Whether this user's name is shown to whoever invited them.
   *
   * `linkedSignal` rather than a plain one: the stored profile is the truth, and
   * this follows it — but the toggle is also flipped optimistically below, so it
   * has to be locally writable. Starts `false`, the same default the server
   * holds, so it never renders as on before the profile confirms that it is.
   */
  readonly showNameToReferrer = linkedSignal(
    () => this.profile()?.showNameToReferrer ?? false,
  );
  readonly savingVisibility = signal(false);

  private savedTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * The standing request for a hryvnia amount, or `null`.
   *
   * Read once rather than polled: this screen shows no book and nothing here
   * changes while it is open. `undefined` is the third state and the reason
   * this is not just `null` — it means "not read yet", so the section renders
   * as nothing at all instead of flashing "you are not subscribed" at somebody
   * who is.
   */
  readonly watch = signal<FiatDepositWatch | null | undefined>(undefined);
  readonly cancellingWatch = signal(false);

  readonly Mode = FiatDepositWatchMode;
  readonly formatUahWhole = formatUahWhole;

  ngOnInit(): void {
    this.store.dispatch(userActions.loadProfile());
    void this.loadWatch();
  }

  /**
   * Runs the tour again, from the top.
   *
   * The tour lives on the dashboard — every step but the first points at
   * something there — so this asks for it and goes home; the overlay appears
   * by itself once that screen has loaded.
   */
  replayTour(): void {
    this.tma.hapticFeedback('light');
    this.tour.replay();
    void this.router.navigate([HOME_ROUTE]);
  }

  /**
   * Cancels the request, and says nothing when it cannot.
   *
   * Optimistic like the toggle above it, and rolled back the same way. There is
   * no error line on this screen because there is nothing a user could do about
   * a failure here except try again — which the restored row invites.
   */
  async onCancelWatch(): Promise<void> {
    const previous = this.watch();
    if (!previous || this.cancellingWatch()) return;

    this.tma.hapticFeedback('light');
    this.cancellingWatch.set(true);
    this.watch.set(null);

    try {
      await this.fiatDeposits.removeWatch();
      this.showSaved();
    } catch (error: unknown) {
      this.watch.set(previous);
      this.tma.hapticFeedback('error');
      console.error('[SettingsComponent] amount-watch cancel failed', error);
    } finally {
      this.cancellingWatch.set(false);
    }
  }

  private async loadWatch(): Promise<void> {
    try {
      this.watch.set(await this.fiatDeposits.getWatch());
    } catch (error: unknown) {
      // Left `undefined`, so the section stays hidden rather than claiming
      // there is no subscription when we simply could not ask.
      console.error('[SettingsComponent] amount-watch load failed', error);
    }
  }

  onSelect(language: AppLanguage): void {
    this.tma.hapticFeedback('light');
    if (language === this.current()) return;

    this.languageService
      .use(language)
      .then(() => this.showSaved())
      .catch((error: unknown) => console.error('[SettingsComponent] language switch failed', error));
  }

  /**
   * Flips the toggle optimistically, then rolls back if the server refuses.
   *
   * A checkbox that waits for a round trip before moving reads as broken on a
   * phone; rolling back on failure keeps the screen honest without that lag.
   */
  async onToggleNameVisibility(show: boolean): Promise<void> {
    this.tma.hapticFeedback('light');
    this.showNameToReferrer.set(show);
    this.savingVisibility.set(true);

    try {
      await this.referralService.setNameVisibility(show);
      // The store still holds the old value; re-reading is what stops the
      // toggle snapping back the next time anything refreshes the profile.
      this.store.dispatch(userActions.loadProfile());
      this.showSaved();
    } catch (error: unknown) {
      this.showNameToReferrer.set(!show);
      this.tma.hapticFeedback('error');
      console.error('[SettingsComponent] name-visibility update failed', error);
    } finally {
      this.savingVisibility.set(false);
    }
  }

  ngOnDestroy(): void {
    clearTimeout(this.savedTimer);
  }

  private showSaved(): void {
    clearTimeout(this.savedTimer);
    this.saved.set(true);
    this.savedTimer = setTimeout(() => this.saved.set(false), SAVED_HINT_MS);
  }
}
