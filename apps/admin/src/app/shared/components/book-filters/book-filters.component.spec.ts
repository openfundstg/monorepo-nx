import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { AdminAmountCurrency, TmaSaleStatus } from '@transacto/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FilterStorageService } from '../../services';
import { BookFiltersComponent } from './book-filters.component';

describe('BookFiltersComponent', () => {
  const build = () => {
    const fixture = TestBed.createComponent(BookFiltersComponent);

    fixture.componentRef.setInput('list', 'sales');
    fixture.componentRef.setInput('variants', []);
    fixture.componentRef.setInput('statuses', [
      { value: TmaSaleStatus.COMPLETED, label: 'x' },
    ]);

    return fixture.componentInstance;
  };

  /** What the form last emitted, which is what the list is narrowed to. */
  const applied = (form: BookFiltersComponent): Record<string, string> => {
    const seen: Record<string, string>[] = [];
    form.apply.subscribe((value) => seen.push({ ...value }));
    form.submit();

    return seen[seen.length - 1] ?? {};
  };

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideTranslateService(),
        // Nothing is remembered between these tests, and nothing is written.
        { provide: FilterStorageService, useValue: { read: vi.fn(() => null), write: vi.fn() } },
      ],
    });
  });

  /**
   * **The hundredfold error this product keeps almost making.**
   *
   * A person types hryvnia; every amount on this wire is kopecks. A form that
   * sent what was typed would filter "sales over ₴5 000" as "sales over ₴50",
   * which is not an error anywhere — it is a list that looks plausible and is
   * wrong, on a screen used to answer questions about money.
   */
  it('sends hryvnia as kopecks', () => {
    const form = build();
    form.form.patchValue({ minAmount: '5000' });

    expect(applied(form)['minAmount']).toBe('500000');
  });

  it('sends USDT as cents, and says which figure it means', () => {
    const form = build();
    form.form.patchValue({ currency: AdminAmountCurrency.USDT, maxAmount: '150.5' });

    expect(applied(form)['maxAmount']).toBe('15050');
    expect(applied(form)['currency']).toBe(AdminAmountCurrency.USDT);
  });

  /** A decimal comma is what a Ukrainian keyboard produces. */
  it('reads a comma as a decimal point', () => {
    const form = build();
    form.form.patchValue({ minAmount: '12,34' });

    expect(applied(form)['minAmount']).toBe('1234');
  });

  /**
   * An absent filter and one set to `''` are different things to a backend that
   * refuses the second — and a filter matching nothing is exactly what that
   * refusal exists to prevent.
   */
  it('drops a field the operator cleared', () => {
    const form = build();
    form.form.patchValue({ minAmount: '5000', status: TmaSaleStatus.COMPLETED });
    form.form.patchValue({ minAmount: '' });

    const query = applied(form);
    expect(query).not.toHaveProperty('minAmount');
    expect(query['status']).toBe(TmaSaleStatus.COMPLETED);
  });

  /**
   * A currency on its own narrows nothing.
   *
   * It says which of a row's two figures a *range* reads, so without a bound it
   * is not a filter — and counting it as one would put a badge on a form that
   * is filtering nothing.
   */
  it('does not send a currency with no bound beside it', () => {
    const form = build();
    form.form.patchValue({ currency: AdminAmountCurrency.USDT });

    expect(applied(form)).not.toHaveProperty('currency');
    expect(form.activeCount()).toBe(0);
  });

  it('counts what is actually narrowing the list', () => {
    const form = build();
    form.form.patchValue({ status: TmaSaleStatus.COMPLETED, from: '2026-09-18' });

    expect(form.activeCount()).toBe(2);
  });
});
