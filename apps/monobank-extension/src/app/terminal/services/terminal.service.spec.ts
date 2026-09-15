import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import type { TerminalBalanceUpdatedDto } from '@transacto/contracts';
import { TerminalService } from './terminal.service';

const balanceEvent = (over: Partial<TerminalBalanceUpdatedDto> = {}): TerminalBalanceUpdatedDto => ({
  terminalId: 23715,
  cardId: 24199,
  sendId: 'abc',
  terminalName: 'Моно Тест',
  currentBalance: 20400,
  hasPendingOrders: false,
  pendingOrdersSum: 0,
  updatedAt: Date.now(),
  ...over,
});

describe('TerminalService.updateTerminalBalance', () => {
  let store: InstanceType<typeof TerminalService>;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    store = TestBed.inject(TerminalService);
  });

  const only = () => store.terminals()[0];

  it('adds a terminal the dashboard load had not seen', () => {
    store.updateTerminalBalance(balanceEvent({ goal: 50000 }));

    expect(only()).toMatchObject({ terminalId: 23715, balance: 20400, goal: 50000 });
  });

  it('applies the goal from the first scrape', () => {
    // The regression: goal was absent from the event, so a terminal loaded
    // before its first scrape sat at 0.00 until the popup was reopened.
    store.setInitialData([{ terminalId: 23715, balance: 0, goal: 0, status: 'ACTIVE' }], []);

    store.updateTerminalBalance(balanceEvent({ currentBalance: 20400, goal: 50000 }));

    expect(only()).toMatchObject({ balance: 20400, goal: 50000 });
  });

  it('keeps a known goal when the bank reports none', () => {
    // An omitted goal means "this scrape says nothing about the goal", not
    // "the goal is now zero".
    store.setInitialData([{ terminalId: 23715, balance: 0, goal: 50000, status: 'ACTIVE' }], []);

    store.updateTerminalBalance(balanceEvent({ currentBalance: 7200, goal: undefined }));

    expect(only()).toMatchObject({ balance: 7200, goal: 50000 });
  });

  it('updates the balance of a terminal it already knows', () => {
    store.setInitialData([{ terminalId: 23715, balance: 100, goal: 50000, status: 'ACTIVE' }], []);

    store.updateTerminalBalance(balanceEvent({ currentBalance: 20400 }));

    expect(store.terminals()).toHaveLength(1);
    expect(only().balance).toBe(20400);
  });
});
