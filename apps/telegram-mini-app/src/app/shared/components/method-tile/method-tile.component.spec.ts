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
  `
})
class HostComponent {}

/**
 * A tile is a link to a screen, and there is nothing else it can be.
 *
 * It used to have a second mode — greyed, badged "in development" and handed no
 * `href` — for a method that was listed before it was built. The card sale was
 * the last one that needed it; the pattern still lives on the sale form's
 * remainder picker, for a policy that really is unbuilt.
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

  const tile = () => (fixture.nativeElement as HTMLElement).querySelector('a') as HTMLAnchorElement

  it('links a method to its screen', () => {
    expect(tile().getAttribute('href')).toBe('/sale/jar')
  })

  /** The pair to the test above — without it, a tile that navigated nowhere would pass. */
  it('follows the link when the tile is tapped', () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true)

    tile().click()

    expect(String(navigate.mock.calls[0]?.[0])).toBe('/sale/jar')
  })

  it('shows the icon it is given', () => {
    expect(tile().querySelector('.method-icon')?.textContent?.trim()).toBe('B')
  })
})
