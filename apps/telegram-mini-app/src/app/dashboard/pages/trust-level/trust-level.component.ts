import { ChangeDetectionStrategy, Component, OnInit, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslatePipe } from '@ngx-translate/core';
import type { TrustLevelRung } from '@transacto/contracts';
import { TmaService } from '../../../auth/services/tma.service';
import { UahPipe } from '../../../shared/pipes/uah.pipe';
import { userActions } from '../../../user/store/user.actions';
import { selectTrustLevel, selectTurnover } from '../../../user/store/user.selectors';
import { trustActions } from '../../store/trust.actions';
import {
  selectNextRung,
  selectTrustLevels,
  selectTrustLoaded,
  selectTurnoverRemaining,
} from '../../store/trust.selectors';

/** One rung, plus where the caller stands in relation to it. */
interface LadderRow {
  readonly rung: TrustLevelRung;
  readonly isCurrent: boolean;
  /** Already earned — this rung or one below it. */
  readonly isReached: boolean;
}

/**
 * What each trust level requires and what it allows.
 *
 * Reached by tapping the trust card on the dashboard, which shows only the
 * current level and a part-filled bar — neither of which says what the levels
 * are or what climbing one is worth.
 *
 * Every figure comes from `GET /api/tma/trust-levels`, the same table the
 * backend grants levels by, so this page cannot quote a threshold the server
 * does not honour.
 *
 * It says nothing about the hryvnia top-up ceiling, which it used to: that
 * ceiling is lifted by a first credited deposit and not by turnover, so a
 * column of it here would attach the rule to the wrong thing — and the top-up
 * screen, which is where somebody meets it, states it in full.
 */
@Component({
  selector: 'app-trust-level',
  imports: [TranslatePipe, UahPipe],
  templateUrl: './trust-level.component.html',
  styleUrl: './trust-level.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TrustLevelComponent implements OnInit {
  private readonly tma = inject(TmaService);
  private readonly router = inject(Router);
  private readonly store = inject(Store);

  readonly turnover = this.store.selectSignal(selectTurnover);
  readonly currentLevel = this.store.selectSignal(selectTrustLevel);
  readonly nextRung = this.store.selectSignal(selectNextRung);
  readonly remaining = this.store.selectSignal(selectTurnoverRemaining);

  private readonly levels = this.store.selectSignal(selectTrustLevels);
  private readonly ladderLoaded = this.store.selectSignal(selectTrustLoaded);

  readonly loading = computed(() => !this.ladderLoaded());

  readonly rows = computed<LadderRow[]>(() => {
    const ladder = this.levels();
    const currentIndex = ladder.findIndex((rung) => rung.level === this.currentLevel());

    return ladder.map((rung, index) => ({
      rung,
      isCurrent: index === currentIndex,
      isReached: index <= currentIndex,
    }));
  });

  ngOnInit(): void {
    this.tma.showBackButton(() => this.router.navigate(['/']));

    // Both are dispatched on every entry and both deduplicate themselves: the
    // ladder's effect drops repeat asks, and the profile refresh is what keeps
    // the turnover on this page from being the one captured at launch.
    this.store.dispatch(trustActions.loadLadder());
    this.store.dispatch(userActions.loadProfile());
  }
}
