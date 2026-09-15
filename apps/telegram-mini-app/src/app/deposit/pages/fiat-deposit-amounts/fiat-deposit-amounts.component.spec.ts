import { TestBed } from '@angular/core/testing'
import { provideZonelessChangeDetection, runInInjectionContext, signal, Injector } from '@angular/core'
import { Router } from '@angular/router'
import { Store } from '@ngrx/store'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FiatDepositWatchMode } from '@transacto/contracts'
import { FiatDepositService } from '../../services/fiat-deposit.service'
import { TmaService } from '../../../auth/services/tma.service'
import { ApiErrorService } from '../../../shared/services/api-error.service'
import { FiatDepositAmountsComponent } from './fiat-deposit-amounts.component'

/**
 * The screen that sends a user back to the top-up they already hold.
 *
 * It earned a spec by trapping one. A top-up sitting in `REVIEW` still holds
 * the user's slot, so every re-read of the offer found it and navigated — from
 * wherever they had got to, every twenty seconds, for as long as an operator
 * took to look at it. Going back bought them one more refresh.
 *
 * Both rules below exist because of that, and neither is cosmetic: one is about
 * *when* a screen may move somebody, the other about whether it may move them
 * after they have already left.
 */
describe('FiatDepositAmountsComponent — sending a user to a top-up they hold', () => {
  const ACTIVE_ID = '6a9f429a1548c1e01d4bc80b'

  let navigate: ReturnType<typeof vi.fn>
  let getOptions: ReturnType<typeof vi.fn>
  let injector: Injector

  const offer = (activeDepositId: string | null) => ({
    options: [{ amountUah: 50_000, cryptoCents: 1101 }],
    exchangeRate: 4538,
    maxAmountUah: null,
    payWindowMinutes: 15,
    bookAvailable: true,
    watch: null,
    activeDepositId,
  })

  const built: FiatDepositAmountsComponent[] = []

  const build = (): FiatDepositAmountsComponent => {
    const component = runInInjectionContext(
      injector,
      () => new FiatDepositAmountsComponent(),
    )
    built.push(component)

    return component
  }

  beforeEach(() => {
    navigate = vi.fn().mockResolvedValue(true)
    getOptions = vi.fn().mockResolvedValue(offer(null))

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: Router, useValue: { navigate } },
        { provide: FiatDepositService, useValue: { getOptions } },
        { provide: TmaService, useValue: { showBackButton: vi.fn(), hideBackButton: vi.fn() } },
        { provide: ApiErrorService, useValue: { translate: vi.fn() } },
        { provide: Store, useValue: { selectSignal: () => signal(4538) } },
      ],
    })

    injector = TestBed.inject(Injector)
  })

  // Every test here starts a screen, and a live screen holds a twenty-second
  // interval that goes on calling `getOptions` long after the test that made
  // it. Harmless while the suite is fast, and the first thing to poison a test
  // that introduces fake timers.
  afterEach(() => built.forEach((component) => component.ngOnDestroy()))

  /** The behaviour that is right, and that the fix must not remove. */
  it('opens the held top-up on the load the user asked for', async () => {
    getOptions.mockResolvedValue(offer(ACTIVE_ID))

    await build().ngOnInit()

    expect(navigate).toHaveBeenCalledWith(['/deposit/fiat', ACTIVE_ID])
  })

  /**
   * The trap. A background refresh must never move the screen: the user may
   * have deliberately walked away from a top-up they can do nothing about, and
   * a refresh that navigated would fetch them back — and again, and again.
   */
  it('never navigates from a background refresh', async () => {
    const component = build()
    await component.ngOnInit()
    navigate.mockClear()

    getOptions.mockResolvedValue(offer(ACTIVE_ID))
    await component.load(true)

    expect(navigate).not.toHaveBeenCalled()
  })

  /**
   * …and stops refreshing once it knows, because nothing on this list can be
   * acted on while a top-up is held. A screen that kept polling would keep
   * finding the same answer for as long as the app was open.
   */
  it('stops re-reading the offer once a held top-up appears', async () => {
    vi.useFakeTimers()

    try {
      const component = build()
      await component.ngOnInit()

      getOptions.mockResolvedValue(offer(ACTIVE_ID))
      await component.load(true)

      const callsSoFar = getOptions.mock.calls.length
      // Three refresh intervals. Before the fix every one of them re-read the
      // offer, found the same held top-up and navigated.
      vi.advanceTimersByTime(60_000)

      expect(getOptions.mock.calls.length).toBe(callsSoFar)
    } finally {
      vi.useRealTimers()
    }
  })

  /**
   * The bar under the rate is a promise that the list is re-reading itself, so
   * it may only be on screen while that is true. The screen that stops polling
   * — a held top-up — is exactly where a bar still filling would be a lie.
   */
  it('advertises the refresh only while it is actually refreshing', async () => {
    const component = build()
    expect(component.polling()).toBe(false)

    await component.ngOnInit()
    expect(component.polling()).toBe(true)

    getOptions.mockResolvedValue(offer(ACTIVE_ID))
    await component.load(true)

    expect(component.polling()).toBe(false)
  })

  /**
   * A load started before the user left resolves after they have gone, and
   * clearing the timer does not stop the request already in flight. Without
   * this check it would navigate somebody who is already somewhere else.
   */
  it('does not navigate once the screen has been left', async () => {
    const component = build()
    await component.ngOnInit()

    component.ngOnDestroy()
    navigate.mockClear()

    getOptions.mockResolvedValue(offer(ACTIVE_ID))
    await component.load()

    expect(navigate).not.toHaveBeenCalled()
  })
})

/**
 * Telling "there is nothing right now" from "this is our fault".
 *
 * The two used to render identically — an empty list — because an unreachable
 * panel is served as `options: []`. One of those sentences asks a user to come
 * back in a minute and the other apologises, and showing the first while the
 * second is true tells somebody the product is quiet when it is broken.
 */
describe('FiatDepositAmountsComponent — an empty book versus a broken one', () => {
  let getOptions: ReturnType<typeof vi.fn>
  let saveWatch: ReturnType<typeof vi.fn>
  let removeWatch: ReturnType<typeof vi.fn>
  let injector: Injector

  const offer = (overrides: Record<string, unknown> = {}) => ({
    options: [],
    exchangeRate: 4538,
    maxAmountUah: null,
    payWindowMinutes: 15,
    bookAvailable: true,
    watch: null,
    activeDepositId: null,
    ...overrides,
  })

  const watchRecord = {
    minAmountUah: 100_000,
    maxAmountUah: 300_000,
    mode: FiatDepositWatchMode.ALWAYS,
    createdAt: '2026-09-10T00:00:00.000Z',
    lastNotifiedAt: null,
  }

  const built: FiatDepositAmountsComponent[] = []

  const build = (): FiatDepositAmountsComponent => {
    const component = runInInjectionContext(
      injector,
      () => new FiatDepositAmountsComponent(),
    )
    built.push(component)

    return component
  }

  beforeEach(() => {
    getOptions = vi.fn().mockResolvedValue(offer())
    saveWatch = vi.fn().mockResolvedValue(watchRecord)
    removeWatch = vi.fn().mockResolvedValue(undefined)

    TestBed.resetTestingModule()
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: Router, useValue: { navigate: vi.fn().mockResolvedValue(true) } },
        { provide: FiatDepositService, useValue: { getOptions, saveWatch, removeWatch } },
        { provide: TmaService, useValue: { showBackButton: vi.fn(), hideBackButton: vi.fn(), hapticFeedback: vi.fn() } },
        { provide: ApiErrorService, useValue: { messageFor: () => 'refused' } },
        { provide: Store, useValue: { selectSignal: () => signal(4538) } },
      ],
    })

    injector = TestBed.inject(Injector)
  })

  // Every test here starts a screen, and a live screen holds a twenty-second
  // interval that goes on calling `getOptions` long after the test that made
  // it. Harmless while the suite is fast, and the first thing to poison a test
  // that introduces fake timers.
  afterEach(() => built.forEach((component) => component.ngOnDestroy()))

  /** An empty book is an empty book, and says so. */
  it('does not apologise for a book that is simply empty', async () => {
    const component = build()
    await component.ngOnInit()

    expect(component.bookAvailable()).toBe(true)
    expect(component.loadFailed()).toBe(false)
  })

  /**
   * The apology used to latch. `loadFailed` was cleared only by a load the user
   * asked for, so a screen whose first read failed kept apologising over a list
   * the very next poll had already filled — with a Retry button as the only way
   * out of a state that had fixed itself twenty seconds earlier.
   */
  it('stops apologising once a background refresh works', async () => {
    getOptions.mockRejectedValueOnce(new Error('offline'))

    const component = build()
    await component.ngOnInit()
    expect(component.loadFailed()).toBe(true)

    await component.load(true)

    expect(component.loadFailed()).toBe(false)
  })

  it('apologises when the panel could not be read', async () => {
    getOptions.mockResolvedValue(offer({ bookAvailable: false }))

    const component = build()
    await component.ngOnInit()

    expect(component.bookAvailable()).toBe(false)
  })

  /**
   * Optimistic, so the apology is never the first thing a user sees while the
   * very first read is still in flight.
   */
  it('assumes the book is readable until told otherwise', () => {
    expect(build().bookAvailable()).toBe(true)
  })
})

/** The standing request for an amount, as this screen manages it. */
describe('FiatDepositAmountsComponent — asking to be told about an amount', () => {
  let getOptions: ReturnType<typeof vi.fn>
  let saveWatch: ReturnType<typeof vi.fn>
  let removeWatch: ReturnType<typeof vi.fn>
  let injector: Injector

  const watchRecord = {
    minAmountUah: 100_000,
    maxAmountUah: 300_000,
    mode: FiatDepositWatchMode.ALWAYS,
    createdAt: '2026-09-10T00:00:00.000Z',
    lastNotifiedAt: null,
  }

  const offer = (watch: typeof watchRecord | null = null) => ({
    options: [],
    exchangeRate: 4538,
    maxAmountUah: null,
    payWindowMinutes: 15,
    bookAvailable: true,
    watch,
    activeDepositId: null,
  })

  const built: FiatDepositAmountsComponent[] = []

  const build = (): FiatDepositAmountsComponent => {
    const component = runInInjectionContext(
      injector,
      () => new FiatDepositAmountsComponent(),
    )
    built.push(component)

    return component
  }

  beforeEach(() => {
    getOptions = vi.fn().mockResolvedValue(offer())
    saveWatch = vi.fn().mockResolvedValue(watchRecord)
    removeWatch = vi.fn().mockResolvedValue(undefined)

    TestBed.resetTestingModule()
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: Router, useValue: { navigate: vi.fn().mockResolvedValue(true) } },
        { provide: FiatDepositService, useValue: { getOptions, saveWatch, removeWatch } },
        { provide: TmaService, useValue: { showBackButton: vi.fn(), hideBackButton: vi.fn(), hapticFeedback: vi.fn() } },
        { provide: ApiErrorService, useValue: { messageFor: () => 'refused' } },
        { provide: Store, useValue: { selectSignal: () => signal(4538) } },
      ],
    })

    injector = TestBed.inject(Injector)
  })

  // Every test here starts a screen, and a live screen holds a twenty-second
  // interval that goes on calling `getOptions` long after the test that made
  // it. Harmless while the suite is fast, and the first thing to poison a test
  // that introduces fake timers.
  afterEach(() => built.forEach((component) => component.ngOnDestroy()))

  /**
   * `undefined` is "not read yet", and it matters most in the case the apology
   * covers: a failed load left `watch` at `null`, so the screen offered "not
   * found a suitable amount? tell us your range" to somebody who already had
   * one — and accepting would have overwritten the range they could no longer
   * see.
   */
  it('claims nothing about the request when the offer could not be read', async () => {
    getOptions.mockRejectedValue(new Error('offline'))

    const component = build()
    await component.ngOnInit()

    expect(component.watch()).toBeUndefined()
  })

  it('knows there is no request once a load says so', async () => {
    const component = build()
    await component.ngOnInit()

    expect(component.watch()).toBeNull()
  })

  /**
   * The offer is re-read every twenty seconds and carries the request with it,
   * so a poll that left before a write answers after it. Without a sequence the
   * just-saved request is blanked back to "not subscribed" — the exact flicker
   * carrying `watch` on the options response was meant to prevent.
   */
  it('does not let a poll issued before a save undo it', async () => {
    const component = build()
    await component.ngOnInit()

    // A refresh that left while the offer still reported no request.
    let answerPoll = (): void => undefined
    getOptions.mockReturnValue(
      new Promise((resolve) => {
        answerPoll = () => resolve(offer(null))
      }),
    )
    const polling = component.load(true)

    await component.saveWatch({
      minAmountUah: 100_000,
      maxAmountUah: 300_000,
      mode: FiatDepositWatchMode.ALWAYS,
    })

    answerPoll()
    await polling

    expect(component.watch()).toEqual(watchRecord)
  })

  /** …and the same in reverse: a cancel must not be undone by a stale answer. */
  it('does not let a poll issued before a cancel resurrect the request', async () => {
    getOptions.mockResolvedValue(offer(watchRecord))
    const component = build()
    await component.ngOnInit()

    let answerPoll = (): void => undefined
    getOptions.mockReturnValue(
      new Promise((resolve) => {
        answerPoll = () => resolve(offer(watchRecord))
      }),
    )
    const polling = component.load(true)

    await component.cancelWatch()

    answerPoll()
    await polling

    expect(component.watch()).toBeNull()
  })

  it('shows the request the server reports', async () => {
    getOptions.mockResolvedValue(offer(watchRecord))

    const component = build()
    await component.ngOnInit()

    expect(component.watch()).toEqual(watchRecord)
  })

  it('closes the sheet once the request is saved', async () => {
    const component = build()
    await component.ngOnInit()
    component.openWatch()

    await component.saveWatch({
      minAmountUah: 100_000,
      maxAmountUah: 300_000,
      mode: FiatDepositWatchMode.ALWAYS,
    })

    expect(component.watch()).toEqual(watchRecord)
    expect(component.editingWatch()).toBe(false)
  })

  /**
   * Two of the three refusals are rules only the server knows — the account's
   * ceiling and the product's own floor — so the sheet stays open carrying its
   * answer rather than closing on a request that was not stored.
   */
  it('keeps the sheet open and shows why when the server refuses', async () => {
    saveWatch.mockRejectedValue(new Error('refused'))

    const component = build()
    await component.ngOnInit()
    component.openWatch()

    await component.saveWatch({
      minAmountUah: 100_000,
      maxAmountUah: 300_000,
      mode: FiatDepositWatchMode.ALWAYS,
    })

    expect(component.editingWatch()).toBe(true)
    expect(component.watchErrorMsg()).toBe('refused')
    expect(component.watch()).toBeNull()
  })

  /**
   * The refresh must not overwrite a form somebody is filling in with what they
   * had before they opened it.
   */
  it('leaves the open sheet alone while the offer refreshes', async () => {
    getOptions.mockResolvedValue(offer(watchRecord))

    const component = build()
    await component.ngOnInit()
    component.openWatch()

    getOptions.mockResolvedValue(offer(null))
    await component.load(true)

    expect(component.watch()).toEqual(watchRecord)
  })

  it('puts the request back when cancelling it fails', async () => {
    getOptions.mockResolvedValue(offer(watchRecord))
    removeWatch.mockRejectedValue(new Error('offline'))

    const component = build()
    await component.ngOnInit()
    await component.cancelWatch()

    expect(component.watch()).toEqual(watchRecord)
  })

  it('clears it when cancelling works', async () => {
    getOptions.mockResolvedValue(offer(watchRecord))

    const component = build()
    await component.ngOnInit()
    await component.cancelWatch()

    expect(removeWatch).toHaveBeenCalled()
    expect(component.watch()).toBeNull()
  })
})
