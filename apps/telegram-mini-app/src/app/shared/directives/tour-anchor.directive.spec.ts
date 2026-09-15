import { Component, provideZonelessChangeDetection, signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { TourAnchorDirective } from './tour-anchor.directive'
import { TourAnchorRegistryService } from '../services/tour-anchor-registry.service'
import { TourStep } from '../enums/tour-step.enum'

/**
 * The balance card sits inside the dashboard's loading `@else`, so the
 * directive's whole job is to follow an element into and out of a conditional
 * branch. The second anchor stands in for the bottom nav, which is always
 * mounted.
 */
@Component({
  imports: [TourAnchorDirective],
  template: `
    @if (shown()) {
      <div class="a" [appTourAnchor]="TourStep.BALANCE"></div>
    }
    <nav [appTourAnchor]="TourStep.NAV"></nav>
  `
})
class HostComponent {
  protected readonly TourStep = TourStep

  readonly shown = signal(true)
}

describe('TourAnchorDirective', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<HostComponent>>
  let registry: TourAnchorRegistryService

  beforeEach(() => {
    TestBed.resetTestingModule()
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] })

    registry = TestBed.inject(TourAnchorRegistryService)
    fixture = TestBed.createComponent(HostComponent)
    fixture.detectChanges()
  })

  const query = (selector: string): HTMLElement | null =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(selector)

  it('registers its host once rendered', () => {
    expect(registry.anchorFor(TourStep.BALANCE)).toBe(query('div.a'))
  })

  it('registers two steps from one template independently', () => {
    expect(registry.anchorFor(TourStep.NAV)).toBe(query('nav'))
  })

  /** What makes the balance card usable as "the dashboard has loaded". */
  it('unregisters when its branch is torn down', async () => {
    fixture.componentInstance.shown.set(false)
    fixture.detectChanges()
    await fixture.whenStable()

    expect(registry.anchorFor(TourStep.BALANCE)).toBeNull()
    expect(registry.anchorFor(TourStep.NAV)).toBe(query('nav'))
  })
})
