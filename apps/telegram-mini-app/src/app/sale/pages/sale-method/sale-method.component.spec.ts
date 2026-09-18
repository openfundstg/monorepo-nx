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

  /**
   * ⚠️ TEMPORARY — these three go when the card variant goes public, leaving
   * the plain "opens the card form" assertion the jar tile has.
   *
   * The variant is built and its route is live; the tile is curtained off while
   * it is tested against production, and five taps pull the curtain.
   */
  const tapCard = async (times: number) => {
    for (let tap = 0; tap < times; tap += 1) {
      const [, card] = anchors()
      card.click()
      await fixture.whenStable()
    }
  }

  it('offers the card as unbuilt until it is tapped open', () => {
    const [, card] = anchors()

    expect(card.hasAttribute('href')).toBe(false)
    expect(card.querySelector('.soon-badge')).not.toBeNull()
  })

  it('stays shut on four taps', async () => {
    await tapCard(4)

    const [, card] = anchors()

    expect(card.hasAttribute('href')).toBe(false)
  })

  it('opens the card form once it has been tapped five times', async () => {
    await tapCard(5)

    const [, card] = anchors()

    expect(card.querySelector('.soon-badge')).toBeNull()
    await opens(card.getAttribute('href'), SaleCardCreateComponent)
  })

  /**
   * The screen asks the server nothing, and that is the assertion.
   *
   * It used to read a kill switch before deciding whether the card tile led
   * anywhere, so the tile changed after it was drawn: greyed on the first frame,
   * live on the next. Whatever the curtain above does, it does on a tap — not
   * on an answer that arrives late.
   */
  it('draws the jar tile live on the first frame, with no request behind it', () => {
    const [jar] = anchors()

    expect(jar.getAttribute('href')).toBe('/sale/jar')
  })

  it('goes back to the dashboard', () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true)
    const [goBack] = showBackButton.mock.calls[0] as [() => void]

    goBack()

    expect(navigate).toHaveBeenCalledWith(['/'])
  })
})
