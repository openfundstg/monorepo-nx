import { TestBed } from '@angular/core/testing'
import { provideZonelessChangeDetection } from '@angular/core'
import { TourAnchorRegistryService } from './tour-anchor-registry.service'
import { TourStep } from '../enums/tour-step.enum'

describe('TourAnchorRegistryService', () => {
  let registry: TourAnchorRegistryService

  beforeEach(() => {
    TestBed.resetTestingModule()
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] })

    registry = TestBed.inject(TourAnchorRegistryService)
  })

  it('answers null for a step nothing has claimed', () => {
    expect(registry.anchorFor(TourStep.BALANCE)).toBeNull()
  })

  /**
   * The overlay reads the map inside a `computed`; a mutated Map is the same
   * reference and would never re-run it, so the element would appear and the
   * spotlight would not.
   */
  it('replaces the map rather than mutating it', () => {
    const element = document.createElement('div')
    const before = registry.anchors()

    registry.register(TourStep.BALANCE, element)

    expect(registry.anchors()).not.toBe(before)
    expect(registry.anchors().get(TourStep.BALANCE)).toBe(element)
  })

  it('lets a later registration win for the same step', () => {
    const first = document.createElement('div')
    const second = document.createElement('div')

    registry.register(TourStep.BALANCE, first)
    registry.register(TourStep.BALANCE, second)

    expect(registry.anchorFor(TourStep.BALANCE)).toBe(second)
  })

  /**
   * Angular may destroy the old instance after the new one has initialised, so
   * the old one's `ngOnDestroy` must not evict its replacement.
   */
  it('ignores an unregister from a stale instance', () => {
    const first = document.createElement('div')
    const second = document.createElement('div')
    registry.register(TourStep.BALANCE, first)
    registry.register(TourStep.BALANCE, second)

    registry.unregister(TourStep.BALANCE, first)

    expect(registry.anchorFor(TourStep.BALANCE)).toBe(second)
  })

  it('forgets the element it was given', () => {
    const element = document.createElement('div')
    registry.register(TourStep.BALANCE, element)

    registry.unregister(TourStep.BALANCE, element)

    expect(registry.anchorFor(TourStep.BALANCE)).toBeNull()
  })
})
