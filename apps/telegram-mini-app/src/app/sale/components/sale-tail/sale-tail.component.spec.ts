import { Component, provideZonelessChangeDetection, signal } from '@angular/core'
import { TestBed, type ComponentFixture } from '@angular/core/testing'
import { provideTranslateService } from '@ngx-translate/core'
import { SaleMethod, type SaleTailProgress } from '@transacto/contracts'
import { beforeEach, describe, expect, it } from 'vitest'
import { SaleTailComponent } from './sale-tail.component'

/** ₴60 left, an operator already asked, and the wait not yet up. */
const tail = (overrides: Partial<SaleTailProgress> = {}): SaleTailProgress => ({
  amount: 6_000,
  announced: true,
  releasableAt: Date.now() + 60_000,
  releasable: false,
  ...overrides
})

@Component({
  imports: [SaleTailComponent],
  template: `
    <app-sale-tail
      [tail]="tail()"
      [method]="method()"
      [busy]="busy()"
      (confirmTail)="confirmed = confirmed + 1"
      (releaseTail)="released = released + 1"
    />
  `
})
class HostComponent {
  readonly tail = signal(tail())
  readonly method = signal(SaleMethod.CARD)
  readonly busy = signal(false)
  confirmed = 0
  released = 0
}

/**
 * The block that explains why a nearly-full sale has stopped.
 *
 * Two things it must never get wrong, and both are about offering a button the
 * endpoint would refuse: a jar seller has nothing to confirm, because their
 * tail is seen rather than reported; and nobody may finish without the
 * transfer before the wait has run out.
 */
describe('SaleTailComponent', () => {
  let fixture: ComponentFixture<HostComponent>
  let host: HostComponent

  beforeEach(async () => {
    TestBed.resetTestingModule()
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideTranslateService()]
    })

    fixture = TestBed.createComponent(HostComponent)
    host = fixture.componentInstance
    await fixture.whenStable()
  })

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement
  const button = (label: string) =>
    Array.from(el().querySelectorAll('button')).find((b) => b.textContent?.includes(label))
  const set = async (overrides: Partial<SaleTailProgress>) => {
    host.tail.set(tail(overrides))
    await fixture.whenStable()
  }

  it('names the gap it is waiting for', () => {
    expect(el().querySelector('.tail-amount')?.textContent).toContain('60')
  })

  /** The reason comes before what to do about it. */
  it('explains why the sale stopped', () => {
    expect(el().querySelector('.tail-why')?.textContent?.trim()).toBe('sale.tail_why')
  })

  describe('when an operator has been asked', () => {
    it('says so, and offers the seller the confirmation', () => {
      expect(el().querySelector('.tail-state')?.textContent?.trim()).toBe('sale.tail_announced')
      expect(button('sale.tail_confirm')).toBeDefined()
    })

    it('emits the confirmation when it is tapped', () => {
      button('sale.tail_confirm')?.click()

      expect(host.confirmed).toBe(1)
    })
  })

  /**
   * The one branch where the delay is the seller's to clear: the statement they
   * owe is about to correct the very figure an operator would be told to
   * transfer, so nobody has been asked and there is nothing to confirm.
   */
  describe('while it is still held for a statement', () => {
    beforeEach(() => set({ announced: false }))

    it('asks for the statement instead', async () => {
      await set({ announced: false })

      expect(el().querySelector('.tail-state')?.textContent?.trim()).toBe(
        'sale.tail_awaiting_statement'
      )
    })

    it('offers nothing to confirm', async () => {
      await set({ announced: false })

      expect(button('sale.tail_confirm')).toBeUndefined()
    })
  })

  /**
   * A jar sale's tail arrives as a balance change the scraper reads, so the
   * sale closes on its own. A button here would be offering to credit the same
   * hryvnia twice — and the endpoint refuses it.
   */
  it('offers a jar seller nothing to confirm', async () => {
    host.method.set(SaleMethod.JAR)
    await fixture.whenStable()

    expect(button('sale.tail_confirm')).toBeUndefined()
    expect(el().querySelector('.tail-why')).not.toBeNull()
  })

  describe('finishing without the transfer', () => {
    /**
     * `releasable` comes from the server rather than being worked out from the
     * date against this device's clock, so the button cannot be offered where
     * the endpoint would refuse it.
     */
    it('is not offered before the wait is up', () => {
      expect(button('sale.tail_release')).toBeUndefined()
      expect(el().textContent).toContain('sale.tail_release_at')
    })

    it('is offered once it is', async () => {
      await set({ releasable: true })

      expect(button('sale.tail_release')).toBeDefined()
      expect(el().textContent).toContain('sale.tail_release_hint')
    })

    it('emits the release when it is tapped', async () => {
      await set({ releasable: true })

      button('sale.tail_release')?.click()

      expect(host.released).toBe(1)
    })

    /** Nobody has been asked, so no clock is running and there is nothing to say. */
    it('promises no date while nobody has been asked', async () => {
      await set({ announced: false, releasableAt: null })

      expect(el().textContent).not.toContain('sale.tail_release_at')
      expect(button('sale.tail_release')).toBeUndefined()
    })
  })

  /** One call at a time: both buttons wait for whichever is in flight. */
  it('disables both buttons while a call is in flight', async () => {
    await set({ releasable: true })
    host.busy.set(true)
    await fixture.whenStable()

    expect(button('sale.tail_confirming')?.disabled).toBe(true)
    expect(button('sale.tail_releasing')?.disabled).toBe(true)
  })
})
