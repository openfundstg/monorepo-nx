import { provideZonelessChangeDetection } from '@angular/core'
import { TestBed, type ComponentFixture } from '@angular/core/testing'
import { Router, provideRouter } from '@angular/router'
import { provideTranslateService } from '@ngx-translate/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TmaService } from '../../../auth/services/tma.service'
import { routes } from '../../routes'
import { SaleCardCreateComponent } from '../sale-card-create/sale-card-create.component'
import { SaleCreateComponent } from '../sale-create/sale-create.component'
import { SaleMethodComponent } from './sale-method.component'

/**
 * The screen in front of the two sale forms.
 *
 * Every live link has to land on a form. A path `sale/routes.ts` does not
 * declare is not an error anywhere — it falls through the app's wildcard and
 * quietly opens the dashboard — so a tile would look alive here and go nowhere
 * in the app.
 */
describe('SaleMethodComponent', () => {
  let fixture: ComponentFixture<SaleMethodComponent>
  let showBackButton: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    showBackButton = vi.fn()

    TestBed.resetTestingModule()
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideTranslateService(),
        { provide: TmaService, useValue: { showBackButton, hideBackButton: vi.fn() } }
      ]
    })

    fixture = TestBed.createComponent(SaleMethodComponent)
    await fixture.whenStable()
  })

  const anchors = () => Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('a'))

  const opens = async (href: string | null | undefined, component: unknown) => {
    const path = href?.replace(/^\/sale\//, '')
    const route = routes.find((candidate) => candidate.path === path)

    expect(await route?.loadComponent?.()).toBe(component)
  }

  it('opens the jar form from the jar tile', async () => {
    const [jar] = anchors()

    await opens(jar.getAttribute('href'), SaleCreateComponent)
  })

  it('opens the card form from the card tile', async () => {
    const [, card] = anchors()

    await opens(card.getAttribute('href'), SaleCardCreateComponent)
  })

  /**
   * **Both tiles, live on the first frame, with no request behind either.**
   *
   * The card tile has been withheld twice, by two different mechanisms, and
   * each left its own mark. First a kill switch read from the server, so the
   * tile changed after it was drawn — greyed and badged "in development" on the
   * first frame, live on the next. Then a tap-to-reveal curtain, which kept a
   * finished variant out of ordinary users' way but asked five taps of the
   * people who were meant to find it.
   *
   * Nothing is withheld now, and this is what says so: an `href` on both
   * anchors before anything has had a chance to answer, and no badge on either.
   */
  it('draws both tiles live on the first frame, with no request behind them', () => {
    const [jar, card] = anchors()

    expect(jar.getAttribute('href')).toBe('/sale/jar')
    expect(card.getAttribute('href')).toBe('/sale/card')
    expect(anchors().some((tile) => tile.querySelector('.soon-badge'))).toBe(false)
  })

  it('goes back to the dashboard', () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true)
    const [goBack] = showBackButton.mock.calls[0] as [() => void]

    goBack()

    expect(navigate).toHaveBeenCalledWith(['/'])
  })
})
