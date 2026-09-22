import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal
} from '@angular/core'
import { Router } from '@angular/router'
import { TranslatePipe } from '@ngx-translate/core'
import { TmaService } from '../../../auth/services/tma.service'
import { MethodTileComponent } from '../../../shared/components/method-tile/method-tile.component'
import { SaleMethodIconComponent } from '../../../shared/components/sale-method-icon/sale-method-icon.component'
import { SaleMethod } from '@transacto/contracts'

/**
 * ⚠️ TEMPORARY — delete this and the three members it supports when the card
 * variant goes public.
 *
 * How many taps on the greyed card tile open it anyway. The variant is built and
 * its route is live; this keeps it out of ordinary users' way while it is tested
 * against production, in the manner of a build-number tap.
 *
 * **A curtain, not a lock, and not meant to be one.** `/sale/card` is reachable
 * by typing it, and nothing on the backend refuses a card sale any more — the
 * kill switch that used to was deliberately removed. What this buys is that
 * nobody arrives at the variant by accident, which is the whole of the job.
 */
const TAPS_TO_REVEAL_CARD = 5

/**
 * Where the hryvnia from a sale arrive, chosen before any form is opened — the
 * same step the top-up flow takes in front of its two forms.
 *
 * The screen asks the server nothing. It used to read a kill switch before
 * deciding whether the card tile led anywhere, and the tile therefore changed
 * after it was drawn: greyed and badged "in development" on the first frame,
 * live on the next. The switch is gone and so is the request behind it.
 *
 * The card tile is greyed again, but by a different mechanism and for a
 * different reason — see {@link TAPS_TO_REVEAL_CARD}. Nothing about it arrives
 * late, so nothing about it moves after the first paint.
 */
@Component({
  selector: 'app-sale-method',
  imports: [TranslatePipe, MethodTileComponent, SaleMethodIconComponent],
  templateUrl: './sale-method.component.html',
  styleUrl: './sale-method.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SaleMethodComponent implements OnInit, OnDestroy {
  private readonly router = inject(Router)
  private readonly tma = inject(TmaService)

  /** Named for the template, which picks a glyph per tile. */
  protected readonly SaleMethod = SaleMethod

  /** ⚠️ TEMPORARY — taps so far on the greyed card tile. */
  private readonly cardTaps = signal(0)

  /** ⚠️ TEMPORARY — whether the card tile has been tapped open. */
  readonly cardRevealed = computed(() => this.cardTaps() >= TAPS_TO_REVEAL_CARD)

  /**
   * ⚠️ TEMPORARY — counts a tap on the greyed card tile.
   *
   * Held in memory, so leaving the screen draws the curtain again. That is the
   * behaviour worth having while this exists: a tester repeats five taps, and
   * nobody else arrives to find it already open.
   *
   * A haptic on the last tap is the only feedback, and the tile turning live is
   * the rest of it. There is deliberately no counter on screen — a progress
   * indicator would tell everybody there is something here to find.
   */
  onCardTap(): void {
    if (this.cardRevealed()) return

    this.cardTaps.update((taps) => taps + 1)

    if (this.cardRevealed()) this.tma.hapticFeedback('success')
  }

  ngOnInit(): void {
    this.tma.showBackButton(() => this.router.navigate(['/']))
  }

  ngOnDestroy(): void {
    this.tma.hideBackButton()
  }
}
