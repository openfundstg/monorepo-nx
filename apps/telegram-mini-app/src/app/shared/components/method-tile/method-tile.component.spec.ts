import { Component, provideZonelessChangeDetection } from '@angular/core'
import { TestBed, type ComponentFixture } from '@angular/core/testing'
import { Router, provideRouter } from '@angular/router'
import { provideTranslateService } from '@ngx-translate/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MethodTileComponent } from './method-tile.component'

@Component({
  imports: [MethodTileComponent],
  template: `
    <app-method-tile link="/sale/jar" titleKey="built" hintKey="built_hint">B</app-method-tile>
    <app-method-tile comingSoon link="/sale/card" titleKey="soon" hintKey="soon_hint">
      S
    </app-method-tile>
  `
})
class HostComponent {}

/**
 * The grey on a tile that is coming soon is a promise that a tap does nothing.
 *
 * The coming-soon tile below is handed a link on purpose: the promise has to
 * hold even for a caller that passes a destination it should not have, which
 * is the easiest way for a screen that does not exist yet to become reachable.
 */
describe('MethodTileComponent', () => {
  let fixture: ComponentFixture<HostComponent>

  beforeEach(async () => {
    TestBed.resetTestingModule()
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideRouter([]), provideTranslateService()]
    })

    fixture = TestBed.createComponent(HostComponent)
    await fixture.whenStable()
  })

  const tiles = () => {
    const [built, soon] = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('a'))

    return { built, soon }
  }

  it('links a built method to its screen', () => {
    expect(tiles().built.getAttribute('href')).toBe('/sale/jar')
  })

  /** The pair to the test below — without it, a tile that navigated nowhere would pass both. */
  it('follows the link when a built method is tapped', () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true)

    tiles().built.click()

    expect(String(navigate.mock.calls[0]?.[0])).toBe('/sale/jar')
  })

  it('leaves a method that is coming soon nothing to follow', () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true)

    tiles().soon.click()

    expect(tiles().soon.hasAttribute('href')).toBe(false)
    expect(navigate).not.toHaveBeenCalled()
  })

  it('badges only the method that is coming soon', () => {
    expect(tiles().built.querySelector('.soon-badge')).toBeNull()
    expect(tiles().soon.querySelector('.soon-badge')?.textContent?.trim()).toBe(
      'common.in_development'
    )
  })

  it('shows the icon it is given', () => {
    expect(tiles().built.querySelector('.method-icon')?.textContent?.trim()).toBe('B')
  })
})
