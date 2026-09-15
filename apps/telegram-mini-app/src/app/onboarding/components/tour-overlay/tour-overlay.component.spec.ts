import { TestBed, type ComponentFixture } from '@angular/core/testing'
import { provideZonelessChangeDetection, signal } from '@angular/core'
import { provideTranslateService } from '@ngx-translate/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TourOverlayComponent } from './tour-overlay.component'
import { OnboardingTourService } from '../../services/onboarding-tour.service'
import { TourAnchorRegistryService } from '../../../shared/services/tour-anchor-registry.service'
import { TmaStorageService } from '../../../shared/services/tma-storage.service'
import { AppVersionService } from '../../../shared/services/app-version.service'
import { SessionExpiryService } from '../../../auth/services/session-expiry.service'
import { TmaService } from '../../../auth/services/tma.service'
import { TourStep } from '../../../shared/enums/tour-step.enum'
import { TOUR_STEPS, TOUR_TITLE_ID } from '../../constants/tour.const'

/** Nothing stored, and every write recorded. */
class StorageStub {
  readonly writes: Array<{ key: string; value: string }> = []

  getLocal(): string | null {
    return null
  }

  async get(): Promise<string | null> {
    return null
  }

  async set(key: string, value: string): Promise<void> {
    this.writes.push({ key, value })
  }
}

/** jsdom has no layout; the component only ever reads these four fields. */
const rect = (top: number, left: number, width: number, height: number): DOMRect =>
  ({
    top,
    left,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({})
  }) as DOMRect

/** Records what was observed and whether it was let go, never calls back. */
class ResizeObserverStub {
  static instances: ResizeObserverStub[] = []

  readonly observe = vi.fn()
  readonly unobserve = vi.fn()
  readonly disconnect = vi.fn()

  constructor() {
    ResizeObserverStub.instances.push(this)
  }
}

/**
 * The overlay's whole job is geometry and focus, which jsdom does not do, so
 * every element's rect is dictated and every animation frame is flushed by
 * hand. What is asserted is what the component does with them: which box it
 * cuts out, where it puts the card, where focus lands, what it refuses.
 */
describe('TourOverlayComponent', () => {
  const originalScrollIntoView = Element.prototype.scrollIntoView
  const updateRequired = signal(false)
  const expired = signal(false)

  let fixture: ComponentFixture<TourOverlayComponent>
  let tour: OnboardingTourService
  let registry: TourAnchorRegistryService
  let storage: StorageStub
  let haptic: ReturnType<typeof vi.fn>
  let lockSwipes: ReturnType<typeof vi.fn>
  let unlockSwipes: ReturnType<typeof vi.fn>
  let frames: FrameRequestCallback[]
  let balanceEl: HTMLElement

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement
  const query = (selector: string): HTMLElement | null => host().querySelector(selector)
  const dialog = (): HTMLElement | null => query('[role="dialog"]')
  const primary = (): HTMLElement => query('.primary-btn') as HTMLElement

  /** An element whose rect is whatever the test says it is. */
  const anchor = (top: number, left: number, width: number, height: number): HTMLElement => {
    const element = document.createElement('div')
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(rect(top, left, width, height))

    return element
  }

  /** One change-detection pass, the queued animation frame, and another pass to draw it. */
  const paint = async (): Promise<void> => {
    fixture.detectChanges()
    for (const frame of frames.splice(0)) frame(0)
    fixture.detectChanges()
    await fixture.whenStable()
  }

  /** Asks for the tour and hands it a loaded dashboard: a 390 × 800 frame at the origin. */
  const activate = async (): Promise<void> => {
    tour.replay()
    registry.register(TourStep.BALANCE, balanceEl)
    fixture.detectChanges()

    const frame = query('.frame') as HTMLElement
    vi.spyOn(frame, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 390, 800))
    await paint()
  }

  const advance = async (steps: number): Promise<void> => {
    for (let step = 0; step < steps; step++) {
      tour.next()
      await paint()
    }
  }

  beforeEach(() => {
    frames = []
    ResizeObserverStub.instances = []
    Element.prototype.scrollIntoView = vi.fn()
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      frames.push(callback)
    )
    vi.stubGlobal('cancelAnimationFrame', vi.fn())

    updateRequired.set(false)
    expired.set(false)
    storage = new StorageStub()
    haptic = vi.fn()
    lockSwipes = vi.fn()
    unlockSwipes = vi.fn()
    balanceEl = anchor(120, 16, 358, 90)

    TestBed.resetTestingModule()
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideTranslateService(),
        { provide: TmaStorageService, useValue: storage },
        { provide: AppVersionService, useValue: { updateRequired } },
        { provide: SessionExpiryService, useValue: { expired } },
        {
          provide: TmaService,
          useValue: {
            hapticFeedback: haptic,
            lockVerticalSwipes: lockSwipes,
            unlockVerticalSwipes: unlockSwipes
          }
        }
      ]
    })

    tour = TestBed.inject(OnboardingTourService)
    registry = TestBed.inject(TourAnchorRegistryService)
    fixture = TestBed.createComponent(TourOverlayComponent)
    fixture.detectChanges()
  })

  afterEach(() => {
    fixture.destroy()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    Element.prototype.scrollIntoView = originalScrollIntoView
  })

  it('renders nothing while inactive', () => {
    expect(dialog()).toBeNull()
    expect(lockSwipes).not.toHaveBeenCalled()
  })

  it('opens a labelled modal dialog once the dashboard is ready', async () => {
    await activate()

    const card = dialog() as HTMLElement
    expect(card.getAttribute('aria-modal')).toBe('true')
    expect(card.getAttribute('aria-labelledby')).toBe(TOUR_TITLE_ID)
    expect(query(`h2#${TOUR_TITLE_ID}`)?.textContent?.trim()).toBe('tour.steps.WELCOME.title')
  })

  it('dims the whole screen and centres the welcome card', async () => {
    await activate()

    expect(query('.scrim')).not.toBeNull()
    expect(query('.highlight')).toBeNull()
    expect(dialog()?.classList.contains('card-center')).toBe(true)
    expect(query('app-logo')).not.toBeNull()
  })

  /**
   * The arithmetic, end to end: a 6 px pad around the anchor, the card 12 px
   * under the cut-out, and the frame's own origin subtracted from both.
   */
  it("casts the spotlight around the step's anchor", async () => {
    await activate()

    await advance(1)

    const highlight = query('.highlight') as HTMLElement
    expect(highlight.style.top).toBe('114px')
    expect(highlight.style.left).toBe('10px')
    expect(highlight.style.width).toBe('370px')
    expect(highlight.style.height).toBe('102px')
    expect(dialog()?.style.top).toBe('228px')
    expect(query('.scrim')).toBeNull()
    expect(query('app-logo')).toBeNull()
  })

  it('falls back to a centred card when the anchor is missing', async () => {
    await activate()

    await advance(2) // TRUST, which nothing has registered

    expect(query('.scrim')).not.toBeNull()
    expect(dialog()?.classList.contains('card-center')).toBe(true)
  })

  /** No tour call in between: the registry alone brings the spotlight up. */
  it('re-anchors the moment the element appears', async () => {
    await activate()
    await advance(2)
    expect(query('.highlight')).toBeNull()

    registry.register(TourStep.TRUST, anchor(300, 16, 358, 70))
    await paint()

    expect(query('.highlight')).not.toBeNull()
    expect(query('.scrim')).toBeNull()
  })

  it('scrolls the anchor into view instantly', async () => {
    await activate()

    await advance(1)

    expect(balanceEl.scrollIntoView).toHaveBeenCalledWith({
      block: 'center',
      behavior: 'instant'
    })
  })

  it('moves focus to the card on each step', async () => {
    await activate()
    expect(document.activeElement).toBe(dialog())

    primary().focus()
    await advance(1)

    expect(document.activeElement).toBe(dialog())
  })

  it('hides Back on the first step and shows it afterwards', async () => {
    await activate()
    expect(query('.ghost-btn')).toBeNull()

    await advance(1)

    expect(query('.ghost-btn')).not.toBeNull()
  })

  it('reads Got it on the last step and Next before it', async () => {
    await activate()
    expect(primary().textContent?.trim()).toBe('tour.next')

    await advance(TOUR_STEPS.length - 1)

    expect(tour.isLast()).toBe(true)
    expect(primary().textContent?.trim()).toBe('tour.done')
  })

  it('skips on the Skip button', async () => {
    await activate()

    ;(query('.card-skip') as HTMLElement).click()
    await paint()

    expect(dialog()).toBeNull()
    expect(storage.writes.at(-1)?.value).toBe('done')
    expect(haptic).toHaveBeenLastCalledWith('light')
  })

  it('skips on Escape', async () => {
    await activate()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await paint()

    expect(dialog()).toBeNull()
    expect(storage.writes.at(-1)?.value).toBe('done')
  })

  /** Focus must not leave the dialog for the page underneath the scrim. */
  it('wraps Tab inside the card', async () => {
    await activate()
    const skip = query('.card-skip') as HTMLElement
    const tab = (shiftKey: boolean): void => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true }))
    }

    // From the card itself — where every step leaves focus — both directions
    // must land on a button, or the browser's next stop is the nav under the
    // scrim and Enter navigates away mid-tour.
    expect(document.activeElement).toBe(dialog())
    tab(true)
    expect(document.activeElement).toBe(primary())

    ;(dialog() as HTMLElement).focus()
    tab(false)
    expect(document.activeElement).toBe(skip)

    // And the two ends wrap onto each other.
    primary().focus()
    tab(false)
    expect(document.activeElement).toBe(skip)

    tab(true)
    expect(document.activeElement).toBe(primary())
  })

  it('gives a success haptic on the final Got it', async () => {
    await activate()
    await advance(TOUR_STEPS.length - 1)

    primary().click()
    await paint()

    expect(haptic).toHaveBeenLastCalledWith('success')
    expect(dialog()).toBeNull()
  })

  /**
   * The page must not scroll under the spotlight, but a card whose text does
   * not fit must still scroll inside itself.
   */
  it('refuses a touchmove outside the card but not inside an overflowing one', async () => {
    await activate()
    const overlay = query('.overlay') as HTMLElement
    const card = dialog() as HTMLElement

    const outside = new Event('touchmove', { cancelable: true, bubbles: true })
    overlay.dispatchEvent(outside)
    expect(outside.defaultPrevented).toBe(true)

    Object.defineProperty(card, 'scrollHeight', { value: 600, configurable: true })
    Object.defineProperty(card, 'clientHeight', { value: 300, configurable: true })
    const inside = new Event('touchmove', { cancelable: true, bubbles: true })
    ;(query('.card-text') as HTMLElement).dispatchEvent(inside)
    expect(inside.defaultPrevented).toBe(false)
  })

  it("holds Telegram's swipe-to-collapse while it is up", async () => {
    await activate()
    expect(lockSwipes).toHaveBeenCalledTimes(1)
    expect(unlockSwipes).not.toHaveBeenCalled()

    tour.skip()
    await paint()

    expect(unlockSwipes).toHaveBeenCalledTimes(1)
  })

  it('tears its observers and listeners down when it closes', async () => {
    await activate()
    await advance(1)
    expect(ResizeObserverStub.instances.length).toBeGreaterThan(0)
    const removed = vi.spyOn(window, 'removeEventListener')

    tour.skip()
    await paint()

    for (const observer of ResizeObserverStub.instances) {
      expect(observer.disconnect).toHaveBeenCalled()
    }
    expect(removed).toHaveBeenCalledWith('resize', expect.any(Function))
    expect(removed).toHaveBeenCalledWith('scroll', expect.any(Function), { capture: true })
    expect(cancelAnimationFrame).toHaveBeenCalled()
  })
})
