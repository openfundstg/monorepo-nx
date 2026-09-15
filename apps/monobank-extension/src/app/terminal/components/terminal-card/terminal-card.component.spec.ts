import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideTranslateService } from '@ngx-translate/core';
import {
  BankProvider,
  SaleRemainderPolicy,
  TerminalSource,
} from '@transacto/contracts';
import { TerminalCardComponent } from './terminal-card.component';
import type { Terminal } from '../../interfaces/terminal.interface';

const terminal = (over: Partial<Terminal> = {}): Terminal => ({
  terminalId: 23715,
  cardId: 24199,
  terminalName: 'Моно Тест',
  bankProvider: BankProvider.MONO,
  balance: 20400,
  goal: 300000,
  status: 'ACTIVE',
  enabled: true,
  ...over,
});

const render = (value: Terminal) => {
  const fixture = TestBed.createComponent(TerminalCardComponent);
  fixture.componentRef.setInput('terminal', value);
  fixture.detectChanges();
  return fixture;
};

describe('TerminalCardComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideTranslateService()],
    });
  });

  describe('the TG flag', () => {
    it('is shown for a terminal the Mini App created', () => {
      const fixture = render(terminal({ source: TerminalSource.TMA }));

      const badge = fixture.nativeElement.querySelector('.tma-badge');
      expect(badge?.textContent?.trim()).toBe('TG');
    });

    it('is hidden for a terminal the trader created', () => {
      const fixture = render(terminal({ source: TerminalSource.TRANSACTO }));

      expect(fixture.nativeElement.querySelector('.tma-badge')).toBeNull();
    });

    it('is hidden when the source is unknown', () => {
      // Terminals stored before the field existed, until the next sync
      const fixture = render(terminal({ source: undefined }));

      expect(fixture.nativeElement.querySelector('.tma-badge')).toBeNull();
    });
  });

  describe('progress', () => {
    it('is the share of the goal that has arrived', () => {
      const fixture = render(terminal({ balance: 20400, goal: 300000 }));

      expect(fixture.componentInstance.percent()).toBeCloseTo(6.8, 1);
    });

    it('never exceeds 100 when the jar is overfunded', () => {
      const fixture = render(terminal({ balance: 400000, goal: 300000 }));

      expect(fixture.componentInstance.percent()).toBe(100);
    });

    it('falls back to full when no goal is known but money is present', () => {
      // Why the missing-goal bug made every funded card look complete
      const fixture = render(terminal({ balance: 20400, goal: undefined }));

      expect(fixture.componentInstance.percent()).toBe(100);
    });
  });

  /**
   * What a trader needs from this is whether a jar will ever ask them for
   * something. One that waits for its full amount raises "almost full" near the
   * goal and needs the last stretch paid in by hand; one that refunds its
   * remainder closes itself and never asks.
   */
  describe('the remainder policy', () => {
    const tma = (policy?: SaleRemainderPolicy) =>
      terminal({ source: TerminalSource.TMA, remainderPolicy: policy });

    /**
     * The flag reads `TG` either way and changes colour. A glyph was tried and
     * measured: at 0.8rem, rotated 45°, an arrow is a smudge.
     */
    it('colours the flag for a jar that refunds its remainder', () => {
      const fixture = render(tma(SaleRemainderPolicy.REFUND_TO_BALANCE));

      const badge = fixture.nativeElement.querySelector('.tma-badge');
      expect(badge.classList.contains('refunds-remainder')).toBe(true);
      expect(badge.textContent.trim()).toBe('TG');
    });

    it('leaves the flag alone for one that waits for the full amount', () => {
      const fixture = render(tma(SaleRemainderPolicy.WAIT_FOR_TOP_UP));

      const badge = fixture.nativeElement.querySelector('.tma-badge');
      expect(badge.classList.contains('refunds-remainder')).toBe(false);
    });

    /** Orders created before the choice existed behaved as "wait". */
    it('treats a missing policy as waiting', () => {
      const fixture = render(tma(undefined));

      expect(
        fixture.nativeElement.querySelector('.tma-badge').classList.contains('refunds-remainder'),
      ).toBe(false);
    });

    /**
     * Only the self-closing kind is labelled. A waiting jar behaves like every
     * terminal the trader created themselves, so marking it would put a chip on
     * most of the cards to state the default.
     */
    it('names the behaviour under the goal, for the refunding kind only', () => {
      const refunding = render(tma(SaleRemainderPolicy.REFUND_TO_BALANCE));
      const waiting = render(tma(SaleRemainderPolicy.WAIT_FOR_TOP_UP));

      expect(refunding.nativeElement.querySelector('.remainder-chip')).not.toBeNull();
      expect(waiting.nativeElement.querySelector('.remainder-chip')).toBeNull();
    });

    /** A terminal with no sale behind it makes no promise either way. */
    it('says nothing on a terminal the trader created', () => {
      const fixture = render(
        terminal({
          source: TerminalSource.TRANSACTO,
          remainderPolicy: SaleRemainderPolicy.REFUND_TO_BALANCE,
        }),
      );

      expect(fixture.nativeElement.querySelector('.remainder-chip')).toBeNull();
    });
  });

  /**
   * A disabled terminal reaches the live dashboard whenever it still has an
   * unread alert, so this is not only the search path's concern.
   */
  describe('a disabled terminal', () => {
    const disabled = (over: Partial<Terminal> = {}) =>
      terminal({ enabled: false, source: TerminalSource.TMA, ...over });

    /**
     * The stamp used to fall back to "balance unknown" when only the *date* was
     * missing — printed beside a balance that was plainly there.
     */
    it('says nothing about the balance when only its age is unknown', () => {
      const fixture = render(disabled({ balance: 85_000, balanceAt: undefined }));

      expect(fixture.nativeElement.querySelector('.archived-stamp')).toBeNull();
      expect(fixture.nativeElement.querySelector('.terminal-balance').textContent).toContain('850');
    });

    it('dates the figures when it knows when they were observed', () => {
      const fixture = render(
        disabled({ balance: 85_000, balanceAt: new Date('2026-08-20T10:00:00Z') }),
      );

      expect(fixture.nativeElement.querySelector('.archived-stamp')).not.toBeNull();
    });

    /** The claim about the balance belongs on the balance. */
    it('renders a dash when the balance itself was never recorded', () => {
      const fixture = render(disabled({ balance: 0, balanceKnown: false }));

      expect(fixture.nativeElement.querySelector('.terminal-balance').textContent.trim()).toBe('—');
    });
  });
});
