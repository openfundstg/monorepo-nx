import { TestBed, type ComponentFixture } from '@angular/core/testing'
import { provideZonelessChangeDetection } from '@angular/core'
import { provideTranslateService } from '@ngx-translate/core'
import { beforeEach, describe, expect, it } from 'vitest'
import { FiatDepositWatchMode, KOPECKS_PER_UAH } from '@transacto/contracts'
import type { FiatDepositWatch, SaveFiatDepositWatchReq } from '@transacto/contracts'
import { FiatWatchModal } from './fiat-watch.modal'

/**
 * The one screen in this app where a user types hryvnia.
 *
 * Three things are worth pinning. People type `1000` and the product speaks
 * kopecks, so the conversion happens here and getting it wrong is a
 * hundredfold error in what somebody is promised. An emptied field is `''`,
 * which `Number` reads as `0` — a value that would sail past a `> 0` check on
 * a form nobody filled in. And the fields are seeded from an existing request,
 * which a plain `signal` initialiser could not do: it runs before Angular sets
 * any input, so it would open an empty form over a request already made.
 */
describe('FiatWatchModal', () => {
  const EXISTING: FiatDepositWatch = {
    minAmountUah: 100_000,
    maxAmountUah: 300_000,
    mode: FiatDepositWatchMode.ONCE,
    createdAt: '2026-09-10T00:00:00.000Z',
    lastNotifiedAt: null,
  }

  let fixture: ComponentFixture<FiatWatchModal>
  let modal: FiatWatchModal
  let saved: SaveFiatDepositWatchReq[]

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideTranslateService()],
    })

    fixture = TestBed.createComponent(FiatWatchModal)
    modal = fixture.componentInstance
    saved = []
    modal.saved.subscribe((request) => saved.push(request))
    fixture.detectChanges()
  })

  it('sends whole hryvnia as kopecks', () => {
    modal.minInput.set('1000')
    modal.maxInput.set('3000')
    modal.mode.set(FiatDepositWatchMode.ONCE)

    modal.submit()

    expect(saved).toEqual([
      {
        minAmountUah: 1000 * KOPECKS_PER_UAH,
        maxAmountUah: 3000 * KOPECKS_PER_UAH,
        mode: FiatDepositWatchMode.ONCE,
      },
    ])
  })

  /**
   * The trap a field initialiser falls into: inputs are set after construction,
   * so a `signal(...)` seeded from `this.watch()` reads the default and shows a
   * blank form to somebody amending a request they can see on the screen behind
   * it.
   */
  it('opens pre-filled with the request being amended', () => {
    fixture.componentRef.setInput('watch', EXISTING)
    fixture.detectChanges()

    expect(modal.minInput()).toBe('1000')
    expect(modal.maxInput()).toBe('3000')
    expect(modal.mode()).toBe(FiatDepositWatchMode.ONCE)
  })

  it('defaults a new request to being told every time', () => {
    expect(modal.minInput()).toBe('')
    expect(modal.mode()).toBe(FiatDepositWatchMode.ALWAYS)
  })

  /** One exact sum is a legitimate request, and the commonest one. */
  it('accepts a range of a single amount', () => {
    modal.minInput.set('5000')
    modal.maxInput.set('5000')

    expect(modal.valid()).toBe(true)
  })

  it.each([
    ['nothing typed at all', '', ''],
    ['only the lower bound', '1000', ''],
    ['a top below the bottom', '3000', '1000'],
    ['a bottom of zero', '0', '1000'],
    ['something that is not a number', 'abc', '1000'],
    ['a fraction of a hryvnia', '10.5', '1000'],
  ])('refuses %s', (_case: string, min: string, max: string) => {
    modal.minInput.set(min)
    modal.maxInput.set(max)

    expect(modal.valid()).toBe(false)
  })

  it('emits nothing when the form is not valid', () => {
    modal.minInput.set('3000')
    modal.maxInput.set('1000')

    modal.submit()

    expect(saved).toEqual([])
  })

  /** A save in flight must not be started a second time by a second tap. */
  it('emits nothing while a save is already running', () => {
    modal.minInput.set('1000')
    modal.maxInput.set('3000')
    fixture.componentRef.setInput('busy', true)
    fixture.detectChanges()

    modal.submit()

    expect(saved).toEqual([])
  })
})
