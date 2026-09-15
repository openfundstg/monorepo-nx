import { provideZonelessChangeDetection } from '@angular/core'
import { TestBed, type ComponentFixture } from '@angular/core/testing'
import { Router, provideRouter } from '@angular/router'
import { provideTranslateService } from '@ngx-translate/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TmaService } from '../../../auth/services/tma.service'
import { routes } from '../../routes'
import { SaleCreateComponent } from '../sale-create/sale-create.component'
import { SaleMethodComponent } from './sale-method.component'

/**
 * The screen in front of the sale form.
 *
 * Its one live link has to land on that form. A path `sale/routes.ts` does not
 * declare is not an error anywhere — it falls through the app's wildcard and
 * quietly opens the dashboard — so the tile would look alive here and go
 * nowhere in the app.
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

  it('opens the jar form from the jar tile', async () => {
    const [jar] = anchors()
    const path = jar.getAttribute('href')?.replace(/^\/sale\//, '')
    const route = routes.find((candidate) => candidate.path === path)

    expect(await route?.loadComponent?.()).toBe(SaleCreateComponent)
  })

  it('lists the card as coming soon, with nothing a tap can open', () => {
    const [, card] = anchors()

    expect(card.hasAttribute('href')).toBe(false)
    expect(card.querySelector('.soon-badge')).not.toBeNull()
  })

  it('goes back to the dashboard', () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true)
    const [goBack] = showBackButton.mock.calls[0] as [() => void]

    goBack()

    expect(navigate).toHaveBeenCalledWith(['/'])
  })
})
