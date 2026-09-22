import { Component, provideZonelessChangeDetection, signal } from '@angular/core'
import { TestBed, type ComponentFixture } from '@angular/core/testing'
import { provideTranslateService } from '@ngx-translate/core'
import { SaleMethod, SaleRemainderPolicy } from '@transacto/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TmaService } from '../../../auth/services/tma.service'
import { SalePricingService } from '../../services/sale-pricing.service'
import { SaleRemainderComponent } from './sale-remainder.component'

@Component({
  imports: [SaleRemainderComponent],
  template: `<app-sale-remainder [method]="method()" [(policy)]="policy" />`
})
class HostComponent {
  readonly method = signal(SaleMethod.CARD)
  readonly policy = signal<SaleRemainderPolicy>(SaleRemainderPolicy.REFUND_TO_BALANCE)
}

/**
 * **What the picker offers is not the same on both forms**, and the difference
 * is not cosmetic: waiting for a tail to be paid in by hand is an ending a jar
 * sale cannot be given yet, so `POST /tma/sales` refuses it. A row that could
 * be chosen and then rejected would read to a user as the app being broken,
 * which is why the availability rule is one function in the contract rather
 * than a list on each side.
 */
describe('SaleRemainderComponent', () => {
  let fixture: ComponentFixture<HostComponent>
  let host: HostComponent

  beforeEach(async () => {
    TestBed.resetTestingModule()
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideTranslateService(),
        { provide: TmaService, useValue: { hapticFeedback: vi.fn() } },
        // The only thing the picker asks it: the figure its copy names.
        { provide: SalePricingService, useValue: { minOrderKopecks: () => 30_000 } }
      ]
    })

    fixture = TestBed.createComponent(HostComponent)
    host = fixture.componentInstance
    await fixture.whenStable()
  })

  const rows = () =>
    Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.remainder-option')
    )

  const asJar = async () => {
    host.method.set(SaleMethod.JAR)
    await fixture.whenStable()
  }

  it('lists every ending the contract defines, on both methods', async () => {
    expect(rows()).toHaveLength(Object.values(SaleRemainderPolicy).length)

    await asJar()

    expect(rows()).toHaveLength(Object.values(SaleRemainderPolicy).length)
  })

  /**
   * Greyed rather than dropped, so the screen answers "can I just wait for the
   * full amount" instead of saying nothing about it — and badged, because the
   * badge is the only thing on a switched-off row that explains why.
   */
  it('greys and badges the ending a jar sale cannot be given', async () => {
    await asJar()

    const [refund, wait] = rows()

    expect(refund.classList.contains('coming-soon')).toBe(false)
    expect(wait.classList.contains('coming-soon')).toBe(true)
    expect(wait.querySelector('.soon-badge')?.textContent?.trim()).toBe('common.in_development')
  })

  it('leaves both endings live on a card sale', () => {
    expect(rows().some((row) => row.classList.contains('coming-soon'))).toBe(false)
    expect(rows().some((row) => row.querySelector('.soon-badge'))).toBe(false)
  })

  /**
   * The pair to the test above. `pointer-events: none` is what a user meets and
   * a stylesheet is not loaded here, so this is the half that holds when the
   * rule changes — the same belt-and-braces the bank picker keeps.
   */
  it('refuses a tap on the ending it greyed out', async () => {
    await asJar()

    rows()[1].click()
    await fixture.whenStable()

    expect(host.policy()).toBe(SaleRemainderPolicy.REFUND_TO_BALANCE)
  })

  it('takes a tap on an ending that is available', async () => {
    rows()[1].click()
    await fixture.whenStable()

    expect(host.policy()).toBe(SaleRemainderPolicy.WAIT_FOR_TOP_UP)
  })

  /**
   * Recommending one ending while pre-selecting another is the disagreement
   * that only shows up in front of a user, so the badge and
   * `DEFAULT_REMAINDER_POLICY` come from the same flag.
   */
  it('badges the recommended ending, and only it', async () => {
    const badged = rows().filter((row) => row.querySelector('.recommended-badge'))

    expect(badged).toHaveLength(1)
    expect(badged[0]).toBe(rows()[0])
    expect(badged[0].querySelector('.recommended-badge')?.textContent?.trim()).toBe(
      'common.recommended'
    )

    await asJar()

    expect(rows().filter((row) => row.querySelector('.recommended-badge'))).toHaveLength(1)
  })

  /** Only ever one badge in that slot: an ending nobody can pick is not one to recommend. */
  it('never draws both badges on one row', async () => {
    await asJar()

    for (const row of rows()) {
      const both = row.querySelector('.soon-badge') && row.querySelector('.recommended-badge')
      expect(both).toBeFalsy()
    }
  })
})
