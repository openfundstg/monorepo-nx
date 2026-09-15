import { TestBed } from '@angular/core/testing'
import { provideZonelessChangeDetection, signal } from '@angular/core'
import { OnboardingTourService } from './onboarding-tour.service'
import { TmaStorageService } from '../../shared/services/tma-storage.service'
import { TourAnchorRegistryService } from '../../shared/services/tour-anchor-registry.service'
import { AppVersionService } from '../../shared/services/app-version.service'
import { SessionExpiryService } from '../../auth/services/session-expiry.service'
import { TourStep } from '../../shared/enums/tour-step.enum'
import { TOUR_STEPS, TOUR_STORAGE_KEY } from '../constants/tour.const'

/**
 * A stand-in for the real storage, with the two reads kept separate so the
 * timing that matters can be asserted: `getLocal` is synchronous and answers
 * during construction, `get` is the awaited cloud round trip — and `set` can
 * be held open, because the real one awaits the cloud for up to 1.5 s before
 * it writes anything locally.
 */
class StorageStub {
  local: string | null = null
  cloud: string | null = null
  readonly writes: Array<{ key: string; value: string }> = []
  /** Whether `set` should wait for the test to release it. */
  holdWrites = false
  /** Each held `set`, oldest first, waiting on its release. */
  readonly inFlight: Array<() => void> = []

  getLocal(key: string): string | null {
    return key === TOUR_STORAGE_KEY ? this.local : null
  }

  async get(key: string): Promise<string | null> {
    return key === TOUR_STORAGE_KEY ? (this.cloud ?? this.local) : null
  }

  async set(key: string, value: string): Promise<void> {
    if (this.holdWrites) await new Promise<void>((release) => this.inFlight.push(release))

    this.writes.push({ key, value })
    this.local = value
  }
}

const build = (setup: (storage: StorageStub) => void = () => undefined) => {
  const storage = new StorageStub()
  setup(storage)
  const updateRequired = signal(false)
  const expired = signal(false)

  TestBed.resetTestingModule()
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      OnboardingTourService,
      TourAnchorRegistryService,
      { provide: TmaStorageService, useValue: storage },
      { provide: AppVersionService, useValue: { updateRequired } },
      { provide: SessionExpiryService, useValue: { expired } }
    ]
  })

  const registry = TestBed.inject(TourAnchorRegistryService)
  const service = TestBed.inject(OnboardingTourService)

  return { service, storage, registry, updateRequired, expired }
}

/** Enough microtasks for the cloud read and a chained write to land. */
const settle = async (): Promise<void> => {
  for (let tick = 0; tick < 4; tick++) await Promise.resolve()
}

const lastWrite = (storage: StorageStub): string | undefined => storage.writes.at(-1)?.value

describe('OnboardingTourService', () => {
  const balanceCard = document.createElement('div')

  it('is inactive for an account that was never marked', () => {
    const { service, registry } = build()

    registry.register(TourStep.BALANCE, balanceCard)

    expect(service.due()).toBe(false)
    expect(service.active()).toBe(false)
  })

  /**
   * The gate. The balance card exists only inside the dashboard's loading
   * `@else`, so its registration is "the home screen is on and loaded" — the
   * spinner and a deep-linked top-up screen both leave it unregistered.
   */
  it('does not paint before the dashboard has loaded', () => {
    const { service, registry } = build()

    service.markPending()
    expect(service.active()).toBe(false)

    registry.register(TourStep.BALANCE, balanceCard)
    expect(service.active()).toBe(true)

    registry.unregister(TourStep.BALANCE, balanceCard)
    expect(service.active()).toBe(false)
  })

  it('starts from the first step for a new account', () => {
    const { service } = build()

    service.markPending()

    expect(service.stepIndex()).toBe(0)
    expect(service.step().id).toBe(TourStep.WELCOME)
    expect(service.stepNumber()).toBe(1)
    expect(service.total).toBe(TOUR_STEPS.length)
    expect(service.isFirst()).toBe(true)
    expect(service.isLast()).toBe(false)
  })

  it('persists pending under a CloudStorage-legal key', async () => {
    const { service, storage } = build()

    service.markPending()
    await settle()

    expect(storage.writes).toEqual([{ key: TOUR_STORAGE_KEY, value: 'pending' }])
    expect(TOUR_STORAGE_KEY).toMatch(/^[A-Za-z0-9_-]{1,128}$/)
  })

  it('walks forward and back within bounds', () => {
    const { service } = build()
    service.replay()

    service.back()
    expect(service.stepIndex()).toBe(0)

    for (let step = 0; step < TOUR_STEPS.length - 1; step++) service.next()
    expect(service.isLast()).toBe(true)

    service.back()
    expect(service.stepIndex()).toBe(TOUR_STEPS.length - 2)
  })

  it('finishing writes done and takes the overlay down', async () => {
    const { service, storage, registry } = build()
    service.markPending()
    registry.register(TourStep.BALANCE, balanceCard)

    for (let step = 0; step < TOUR_STEPS.length; step++) service.next()
    await settle()

    expect(service.active()).toBe(false)
    expect(service.stepIndex()).toBe(0)
    expect(lastWrite(storage)).toBe('done')
  })

  it('skipping writes done too', async () => {
    const { service, storage, registry } = build()
    service.markPending()
    registry.register(TourStep.BALANCE, balanceCard)
    service.next()

    service.skip()
    await settle()

    expect(service.active()).toBe(false)
    expect(service.stepIndex()).toBe(0)
    expect(lastWrite(storage)).toBe('done')
  })

  /**
   * Read synchronously, before anything renders: a new user who closed the app
   * mid-tour gets it again, from the top, without waiting on the cloud.
   */
  it('resumes from the start after a launch that left it pending', () => {
    const { service, registry } = build((storage) => {
      storage.local = 'pending'
    })

    registry.register(TourStep.BALANCE, balanceCard)

    expect(service.active()).toBe(true)
    expect(service.stepIndex()).toBe(0)
  })

  /** A tour owed on one device is owed on every device. */
  it('adopts a pending tour stored on another device', async () => {
    const { service } = build((storage) => {
      storage.cloud = 'pending'
    })

    expect(service.due()).toBe(false) // nothing local yet
    await settle()

    expect(service.due()).toBe(true)
  })

  it('adopts a finish recorded on another device', async () => {
    const { service } = build((storage) => {
      storage.local = 'pending'
      storage.cloud = 'done'
    })

    expect(service.due()).toBe(true) // the local snapshot, before the cloud answers
    await settle()

    expect(service.due()).toBe(false)
  })

  /**
   * Monotonic: a device that never synced its `done` must not reopen a tour
   * the user finished elsewhere.
   */
  it('keeps done when a stale pending arrives from the cloud', async () => {
    const { service } = build((storage) => {
      storage.local = 'done'
      storage.cloud = 'pending'
    })

    await settle()

    expect(service.due()).toBe(false)
  })

  /**
   * The race the implementation guards against. The cloud read is in flight
   * for up to 1.5 s after launch — long enough to skip the tour first — and a
   * reconcile landing afterwards would silently bring it back.
   */
  it('does not let a late cloud read resurrect a tour the user just skipped', async () => {
    const { service, storage } = build((storage) => {
      storage.local = 'pending'
      storage.cloud = 'pending'
    })

    service.skip() // before the cloud has answered
    await settle()

    expect(service.due()).toBe(false)
    expect(lastWrite(storage)).toBe('done')
  })

  /**
   * The same race the other way round, and the one where the guard is
   * load-bearing: the account was just created — a server-side reset, with
   * CloudStorage still holding an old `done` — and the cloud answers after
   * `markPending()`. Without the guard the monotonic rule would adopt that
   * `done` and the tour just owed would silently never show.
   */
  it('does not let a late cloud done cancel a tour just owed', async () => {
    const { service } = build((storage) => {
      storage.cloud = 'done'
    })

    service.markPending() // before the cloud has answered
    await settle()

    expect(service.due()).toBe(true)
  })

  /** A stray value must not read as truthy and start a tour. */
  it('ignores a value it did not write', () => {
    const { service, registry } = build((storage) => {
      storage.local = 'true'
    })

    registry.register(TourStep.BALANCE, balanceCard)

    expect(service.due()).toBe(false)
    expect(service.active()).toBe(false)
  })

  it('replays on request even when done', async () => {
    const { service, storage, registry } = build((storage) => {
      storage.local = 'done'
    })

    service.replay()
    registry.register(TourStep.BALANCE, balanceCard)
    await settle()

    expect(service.active()).toBe(true)
    expect(service.stepIndex()).toBe(0)
    // Asking for a replay records nothing: an abandoned one must not come back.
    expect(storage.writes).toEqual([])

    for (let step = 0; step < TOUR_STEPS.length; step++) service.next()
    await settle()

    expect(service.active()).toBe(false)
    expect(lastWrite(storage)).toBe('done')
  })

  /**
   * Leaving the home screen hides the tour rather than ending it; coming back
   * picks up where it was, because the index lives in memory, not in storage.
   */
  it('keeps the step while the dashboard is away', () => {
    const { service, registry } = build()
    service.replay()
    registry.register(TourStep.BALANCE, balanceCard)
    service.next()
    service.next()

    registry.unregister(TourStep.BALANCE, balanceCard)
    expect(service.active()).toBe(false)
    expect(service.stepIndex()).toBe(2)

    registry.register(TourStep.BALANCE, balanceCard)
    expect(service.active()).toBe(true)
    expect(service.stepIndex()).toBe(2)
  })

  /** Neither screen can be worked around, so the tour's keys must not run under them. */
  it('hides under the update and session screens', () => {
    const { service, registry, updateRequired, expired } = build()
    service.replay()
    registry.register(TourStep.BALANCE, balanceCard)
    expect(service.active()).toBe(true)

    updateRequired.set(true)
    expect(service.active()).toBe(false)
    updateRequired.set(false)
    expect(service.active()).toBe(true)

    expired.set(true)
    expect(service.active()).toBe(false)
    expired.set(false)
    expect(service.active()).toBe(true)
  })

  /**
   * `TmaStorageService.set` writes the cloud first and local second, so two
   * overlapping writes could land locally in the wrong order if the first is
   * slow. The chain issues the second only once the first has settled.
   */
  it('lands writes in the order they were issued', async () => {
    const { service, storage } = build((storage) => {
      storage.holdWrites = true
    })

    service.markPending()
    service.skip()
    await settle()

    // Only the first write has gone out; `done` is waiting behind it.
    expect(storage.inFlight).toHaveLength(1)
    expect(storage.writes).toEqual([])

    storage.inFlight[0]()
    await settle()
    expect(storage.inFlight).toHaveLength(2)

    storage.inFlight[1]()
    await settle()

    expect(storage.writes.map((write) => write.value)).toEqual(['pending', 'done'])
    expect(storage.local).toBe('done')
  })
})
