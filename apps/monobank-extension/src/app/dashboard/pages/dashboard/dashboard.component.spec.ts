import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideTranslateService } from '@ngx-translate/core';
import { BankProvider, TerminalSource } from '@transacto/contracts';
import { DashboardComponent } from './dashboard.component';
import { TerminalService } from '../../../terminal/services/terminal.service';
import { TerminalFilter } from '../../../terminal/enums/terminal-filter.enum';
import type { Terminal } from '../../../terminal/interfaces/terminal.interface';

const terminal = (over: Partial<Terminal>): Terminal => ({
  balance: 0,
  status: 'ACTIVE',
  ...over,
});

const TERMINALS: Terminal[] = [
  terminal({
    terminalId: 23715,
    terminalName: 'Моно Тест',
    bankProvider: BankProvider.MONO,
    source: TerminalSource.TRANSACTO,
  }),
  terminal({
    terminalId: 23892,
    terminalName: 'TMA-885140-1739',
    bankProvider: BankProvider.PRIVAT,
    source: TerminalSource.TMA,
  }),
  terminal({
    terminalId: 23893,
    terminalName: 'Тест ПУМБ',
    bankProvider: BankProvider.PUMB,
    // Predates the source field — must not be mistaken for a TMA terminal
    source: undefined,
  }),
];

describe('DashboardComponent filtering', () => {
  let component: DashboardComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideTranslateService()],
    });

    TestBed.inject(TerminalService).setInitialData(TERMINALS, []);
    component = TestBed.createComponent(DashboardComponent).componentInstance;
  });

  const visibleNames = () => component.terminals().map((t) => t.terminalName);

  it('shows everything by default', () => {
    expect(visibleNames()).toEqual(['Моно Тест', 'TMA-885140-1739', 'Тест ПУМБ']);
  });

  it('narrows to Mini App terminals', () => {
    component.setFilter(TerminalFilter.TMA);

    expect(visibleNames()).toEqual(['TMA-885140-1739']);
  });

  it('treats a terminal with no source as not-TMA', () => {
    // Terminals stored before the field existed must land in "other", never in
    // the TMA bucket — the badge and the filter have to agree.
    component.setFilter(TerminalFilter.OTHER);

    expect(visibleNames()).toEqual(['Моно Тест', 'Тест ПУМБ']);
  });

  it('counts the Mini App terminals for the chip regardless of the active filter', () => {
    component.setFilter(TerminalFilter.OTHER);

    expect(component.tmaCount()).toBe(1);
  });

  describe('search', () => {
    it('matches on name, case-insensitively', () => {
      component.search.set('пумб');

      expect(visibleNames()).toEqual(['Тест ПУМБ']);
    });

    it('matches on bank provider', () => {
      component.search.set('privat');

      expect(visibleNames()).toEqual(['TMA-885140-1739']);
    });

    it('matches on terminal id', () => {
      component.search.set('23893');

      expect(visibleNames()).toEqual(['Тест ПУМБ']);
    });

    it('ignores surrounding whitespace', () => {
      component.search.set('  Моно  ');

      expect(visibleNames()).toEqual(['Моно Тест']);
    });

    it('combines with the type filter rather than replacing it', () => {
      component.setFilter(TerminalFilter.OTHER);
      component.search.set('тест');

      expect(visibleNames()).toEqual(['Моно Тест', 'Тест ПУМБ']);
    });

    it('returns nothing when there is no match, while terminals still exist', () => {
      component.search.set('нічого');

      expect(component.terminals()).toEqual([]);
      expect(component.hasTerminals()).toBe(true);
    });
  });
});
