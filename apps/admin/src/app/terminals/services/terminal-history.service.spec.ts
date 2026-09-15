import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import type { TerminalHistoryUpdatedDto } from '@transacto/contracts';
import { Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminSocketService } from '../../core/services/admin-socket.service';
import { TerminalsApiService } from './terminals.api.service';
import { TerminalHistoryService } from './terminal-history.service';

const row = (over: Partial<TerminalHistoryUpdatedDto> = {}) =>
  ({
    _id: 'row-0',
    cardId: 4242,
    traderId: 7,
    timestamp: new Date().toISOString(),
    balance: 100_000,
    baseline: 100_000,
    expectedBalance: 100_000,
    delta: 0,
    orderEvents: [],
    alerts: [],
    ...over,
  }) as unknown as TerminalHistoryUpdatedDto;

describe('TerminalHistoryService', () => {
  const stream = new Subject<TerminalHistoryUpdatedDto>();
  const history = vi.fn();

  const build = (): TerminalHistoryService => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: TerminalsApiService, useValue: { history } },
        {
          provide: AdminSocketService,
          useValue: { terminalHistoryAppended: () => stream.asObservable() },
        },
      ],
    });

    return TestBed.inject(TerminalHistoryService);
  };

  beforeEach(() => {
    history.mockReset();
    history.mockResolvedValue({ items: [row({ _id: 'existing' })], total: 1, page: 1, limit: 100 });
  });

  it('loads the jar it was asked for', async () => {
    const service = build();
    await service.load(4242);

    expect(history).toHaveBeenCalledWith(4242, expect.objectContaining({ page: 1 }));
    expect(service.logs()).toHaveLength(1);
  });

  /**
   * The stream carries every terminal's rows — there is no per-terminal room —
   * so the screen filters. Without this, opening one jar would show another's
   * scrapes appearing in it.
   */
  it('ignores a row for a different terminal', async () => {
    const service = build();
    await service.load(4242);

    stream.next(row({ _id: 'other', cardId: 9999 }));

    expect(service.logs()).toHaveLength(1);
  });

  it('puts a live row for this terminal at the top', async () => {
    const service = build();
    await service.load(4242);

    stream.next(row({ _id: 'fresh', cardId: 4242 }));

    // Newest first, which is the order the shared table measures its movement
    // arrows against.
    expect(service.logs().map((log) => log._id)).toEqual(['fresh', 'existing']);
  });

  /** The shared table styles it as newly arrived; the extension does the same. */
  it('marks a live row as new', async () => {
    const service = build();
    await service.load(4242);

    stream.next(row({ _id: 'fresh', cardId: 4242 }));

    expect(service.logs()[0].isNew).toBe(true);
    expect(service.logs()[1].isNew).toBeUndefined();
  });

  it('does not mutate the rows it already holds', async () => {
    const service = build();
    await service.load(4242);
    const before = service.logs();

    stream.next(row({ _id: 'fresh', cardId: 4242 }));

    expect(service.logs()).not.toBe(before);
    expect(before).toHaveLength(1);
  });

  it('clears the loading flag even when the request fails', async () => {
    history.mockRejectedValue(new Error('offline'));
    const service = build();

    await expect(service.load(4242)).rejects.toThrow();
    expect(service.loading()).toBe(false);
  });
});
