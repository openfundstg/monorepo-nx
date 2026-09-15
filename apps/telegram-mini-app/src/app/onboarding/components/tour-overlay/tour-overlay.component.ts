import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild
} from '@angular/core'
import { TranslatePipe } from '@ngx-translate/core'
import { LogoComponent } from '../../../shared/components/logo/logo.component'
import { TourAnchorRegistryService } from '../../../shared/services/tour-anchor-registry.service'
import { TmaService } from '../../../auth/services/tma.service'
import { OnboardingTourService } from '../../services/onboarding-tour.service'
import { TourCardSide } from '../../enums/tour-card-side.enum'
import { TOUR_GEOMETRY } from '../../enums/tour-geometry.enum'
import { TourKey } from '../../enums/tour-key.enum'
import { TOUR_TITLE_ID } from '../../constants/tour.const'
import type { TourLayout } from '../../interfaces/tour-layout.interface'
import { CENTERED_PLACEMENT, placeTourCard, toBox } from '../../utils/tour-placement.util'

/**
 * The spotlight and its card, drawn once by the shell.
 *
 * Everything reactive here is a `computed` over signals the callbacks below
 * write: `layout` is set from a `requestAnimationFrame`, a `ResizeObserver`
 * and the scroll/resize listeners — none of which is an effect. The two
 * effects do DOM and SDK work only and never write a signal; the one thing
 * they schedule is the callback that does.
 *
 * No inputs: shell chrome reading two root services, exactly like
 * `<app-loading-overlay />`. It renders nothing until `OnboardingTourService`
 * says the tour is due and the dashboard has loaded.
 */
@Component({
  selector: 'app-tour-overlay',
  imports: [TranslatePipe, LogoComponent],
  templateUrl: './tour-overlay.component.html',
  styleUrl: './tour-overlay.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class TourOverlayComponent {
  protected readonly tour = inject(OnboardingTourService)
  private readonly registry = inject(TourAnchorRegistryService)
  private readonly tma = inject(TmaService)

  /** Named for the template; the bindings compare against members, not strings. */
  protected readonly TourCardSide = TourCardSide
  protected readonly TITLE_ID = TOUR_TITLE_ID
  /** Handed to the stylesheet as `--tour-pad`, so the cut-out's radius follows the padding. */
  protected readonly HIGHLIGHT_PAD_PX = TOUR_GEOMETRY.HIGHLIGHT_PAD_PX

  private readonly overlay = viewChild<ElementRef<HTMLElement>>('overlay')
  private readonly frame = viewChild<ElementRef<HTMLElement>>('frame')
  private readonly card = viewChild<ElementRef<HTMLElement>>('card')

  /**
   * What was last measured — written ONLY from callbacks, never from an effect
   * body. Deliberately not reset on a step change: the stale value is what the
   * highlight's CSS transition animates *from* for the one frame before the
   * next measurement lands.
   */
  private readonly layout = signal<TourLayout | null>(null)

  protected readonly placement = computed(() => {
    const layout = this.layout()

    return layout ? placeTourCard(layout, TOUR_GEOMETRY) : CENTERED_PLACEMENT
  })

  /**
   * Everything is refused except a scroll inside a card that actually
   * overflows — a long translation on a short phone still has to be readable.
   */
  private readonly refuseScroll = (event: Event): void => {
    const card = this.card()?.nativeElement
    const insideScrollableCard =
      !!card &&
      event.target instanceof Node &&
      card.contains(event.target) &&
      card.scrollHeight > card.clientHeight

    if (!insideScrollableCard) event.preventDefault()
  }

  /**
   * Escape dismisses, as a modal dialog's contract says; Tab cycles the card's
   * buttons so focus cannot wander onto the page beneath the scrim. On
   * `document`, so both work whatever happens to hold focus.
   */
  private readonly onKeydown = (event: KeyboardEvent): void => {
    if (event.key === TourKey.ESCAPE) {
      event.preventDefault()
      this.onSkip()
      return
    }
    if (event.key !== TourKey.TAB) return

    const card = this.card()?.nativeElement
    if (!card) return

    const stops = Array.from(card.querySelectorAll<HTMLElement>('button'))
    const first = stops.at(0)
    const last = stops.at(-1)
    if (!first || !last) return

    // Focus starts on the card itself after every step, and a tap on the scrim
    // drops it on the body; from either, the browser's next stop in *both*
    // directions is the page under the scrim. So anything outside the buttons
    // goes to a button, and the two ends wrap onto each other.
    const active = document.activeElement
    const outside = active === card || !card.contains(active)
    const wrapsForward = !event.shiftKey && (outside || active === last)
    const wrapsBackward = event.shiftKey && (outside || active === first)
    if (!wrapsForward && !wrapsBackward) return

    event.preventDefault()
    ;(wrapsForward ? first : last).focus()
  }

  /**
   * Follows the step: scrolls its anchor into view, measures, watches for
   * movement, and moves focus.
   *
   * Re-runs when the step changes, when the anchor (un)registers, and when the
   * `@if` renders the frame and card — the view children are signals, so the
   * first run (before the template has rendered) simply returns and the next
   * one finds them. `step()` is a fresh object per index, so two steps in a row
   * that share an anchor — or both lack one — still each get their measurement
   * and their focus move.
   */
  private readonly follow = effect((onCleanup) => {
    if (!this.tour.active()) return
    const frame = this.frame()?.nativeElement
    const card = this.card()?.nativeElement
    if (!frame || !card) return

    const step = this.tour.step()
    const anchor = step.anchored ? this.registry.anchorFor(step.id) : null

    // Instant, centred. The highlight's own CSS transition supplies the motion;
    // a smooth scroll would hand the rAF below a rect measured mid-flight.
    // Not for a fixed anchor (the nav): Chrome knows it is always in view, but
    // WebKit centres its document-space rect and scrolls the page under the
    // scrim for nothing. jsdom has no scrollIntoView, hence `?.`.
    if (anchor && getComputedStyle(anchor).position !== 'fixed') {
      anchor.scrollIntoView?.({ block: 'center', behavior: 'instant' })
    }

    // Closes over the elements this run captured and reads no signal, so no
    // late callback can measure a detached element after cleanup.
    const measure = (): void => {
      this.layout.set({
        frame: toBox(frame.getBoundingClientRect()),
        anchor: anchor ? toBox(anchor.getBoundingClientRect()) : null,
        cardHeight: card.offsetHeight || TOUR_GEOMETRY.CARD_FALLBACK_HEIGHT_PX
      })
    }

    const frameId = requestAnimationFrame(() => {
      measure()
      // After the geometry settles, and without scrolling: a focus that scrolled
      // would move the page out from under the highlight just measured.
      card.focus({ preventScroll: true })
    })

    // The anchor grows (the rate line under a tile arrives late); things ABOVE
    // it grow (the jar reminder, the profit banner) and push it down without
    // resizing it — observing body catches the second, which no scroll event
    // would; the frame shrinks when Telegram's insets appear (fullscreen, a
    // rotation), which fires no event at all; and the card's own height
    // decides above/below.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    if (anchor) observer?.observe(anchor)
    observer?.observe(document.body)
    observer?.observe(frame)
    observer?.observe(card)
    window.addEventListener('resize', measure, { passive: true })
    window.addEventListener('scroll', measure, { capture: true, passive: true })

    onCleanup(() => {
      cancelAnimationFrame(frameId)
      observer?.disconnect()
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, { capture: true })
    })
  })

  /**
   * Holds the page still and answers the keyboard while the tour is up.
   *
   * Not `overflow: hidden` on `body` — iOS ignores it and some versions reset
   * the scroll position, moving every anchor. `passive: false` is the whole
   * point, as `ZoomLockService` explains: the browser assumes passive for
   * touch events unless told otherwise, and a passive listener may not call
   * `preventDefault`. Telegram's own swipe-to-collapse is native and sees none
   * of this, hence the SDK call.
   */
  private readonly lock = effect((onCleanup) => {
    const root = this.overlay()?.nativeElement
    if (!root) return

    root.addEventListener('touchmove', this.refuseScroll, { passive: false })
    root.addEventListener('wheel', this.refuseScroll, { passive: false })
    document.addEventListener('keydown', this.onKeydown)
    this.tma.lockVerticalSwipes()

    onCleanup(() => {
      root.removeEventListener('touchmove', this.refuseScroll)
      root.removeEventListener('wheel', this.refuseScroll)
      document.removeEventListener('keydown', this.onKeydown)
      this.tma.unlockVerticalSwipes()
    })
  })

  /** The final "Got it" earns the success buzz; every other step is a plain tap. */
  protected onNext(): void {
    this.tma.hapticFeedback(this.tour.isLast() ? 'success' : 'light')
    this.tour.next()
  }

  protected onBack(): void {
    this.tma.hapticFeedback('light')
    this.tour.back()
  }

  protected onSkip(): void {
    this.tma.hapticFeedback('light')
    this.tour.skip()
  }
}
