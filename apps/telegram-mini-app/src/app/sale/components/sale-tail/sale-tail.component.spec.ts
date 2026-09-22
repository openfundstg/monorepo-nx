import { Component, provideZonelessChangeDetection, signal } from '@angular/core'
import { TestBed, type ComponentFixture } from '@angular/core/testing'
import { provideTranslateService } from '@ngx-translate/core'
import { SaleMethod, type SaleTailProgress } from '@transacto/contracts'
import { beforeEach, describe, expect, it } from 'vitest'
import { SaleTailComponent } from './sale-tail.component'

/**
 * ₴60 left, asked for and taken on — the state the block is drawn in while a
 * transfer is actually on its way, and the sale is no longer the seller's to
 * end.
 */
const tail = (overrides: Partial<SaleTailProgress> = {}): SaleTailProgress => ({
  amount: 6_000,
  announced: true,
  claimed: true,
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
    />
  `
})
class HostComponent {
  readonly tail = signal(tail())
  readonly method = signal(SaleMethod.CARD)
  readonly busy = signal(false)
  confirmed = 0
}

/**
 * The block that explains why a nearly-full sale has stopped.
 *
 * Two things it must never get wrong, and both are about offering a button the
 * endpoint would refuse: a jar seller has nothing to confirm, because their
 * tail is seen rather than reported, and nobody may confirm a transfer no
 * operator has taken on, because nothing was ever started.
 *
 * There is no third button. The other ending — the gap coming back as USDT — is
 * an operator's call now, so this block names support rather than a time.
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

  describe('when an operator has taken the transfer on', () => {
    it('reads as an order, and offers the seller the confirmation', () => {
      expect(el().querySelector('.tail-state')?.textContent?.trim()).toBe('sale.tail_taken')
      expect(el().querySelector('.tail-title')?.textContent?.trim()).toBe(
        'sale.tail_order_title',
      )
      expect(button('sale.tail_confirm')).toBeDefined()
    })

    /**
     * The sale is no longer the seller's to end, and that is said here rather
     * than left to be discovered by a stop button that has quietly gone.
     */
    it('says why the sale can no longer be stopped', () => {
      expect(el().textContent).toContain('sale.tail_hold')
    })

    it('emits the confirmation when it is tapped', () => {
      button('sale.tail_confirm')?.click()

      expect(host.confirmed).toBe(1)
    })
  })

  /**
   * Asked is not taken on. Nobody has gone to their banking app yet, so there is
   * nothing that could have landed — and the endpoint refuses the confirmation
   * with `TAIL_NOT_CLAIMED` for exactly that reason.
   */
  describe('while the alert is unanswered', () => {
    beforeEach(() => set({ claimed: false }))

    it('says somebody has been asked, and offers nothing to confirm', async () => {
      await set({ claimed: false })

      expect(el().querySelector('.tail-state')?.textContent?.trim()).toBe('sale.tail_announced')
      expect(button('sale.tail_confirm')).toBeUndefined()
    })

    /** The sale is still theirs to end, so nothing may claim otherwise. */
    it('does not say the sale is held', async () => {
      await set({ claimed: false })

      expect(el().textContent).not.toContain('sale.tail_hold')
    })
  })

  /**
   * The one branch where the delay is the seller's to clear: the statement they
   * owe is about to correct the very figure an operator would be told to
   * transfer, so nobody has been asked and there is nothing to confirm.
   */
  describe('while it is still held for a statement', () => {
    beforeEach(() => set({ announced: false, claimed: false }))

    it('asks for the statement instead', async () => {
      await set({ announced: false, claimed: false })

      expect(el().querySelector('.tail-state')?.textContent?.trim()).toBe(
        'sale.tail_awaiting_statement'
      )
    })

    it('offers nothing to confirm', async () => {
      await set({ announced: false, claimed: false })

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

  /** A second tap must not be a second request. */
  it('disables the confirmation while the call is in flight', async () => {
    host.busy.set(true)
    await fixture.whenStable()

    expect(button('sale.tail_confirming')?.disabled).toBe(true)
  })

  /**
   * There is no way out of the hold on this screen, and that is the design: a
   * seller saying the transfer never came is making a claim about what an
   * operator did, so the block sends them to the people who can check.
   */
  it('offers no way to finish without the transfer', () => {
    expect(el().textContent).toContain('sale.tail_hold')
    expect(el().querySelectorAll('button')).toHaveLength(1)
  })
})
