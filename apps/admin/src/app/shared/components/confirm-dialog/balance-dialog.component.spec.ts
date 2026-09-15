import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideTranslateService } from '@ngx-translate/core';
import { AdminBalanceOperation, AdminBalanceTarget } from '@transacto/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BalanceDialogComponent, type BalanceDialogData } from './balance-dialog.component';

const DATA: BalanceDialogData = {
  username: '@oleg',
  balance: 18_500,
  referralBalance: 0,
};

describe('BalanceDialogComponent', () => {
  const close = vi.fn();

  const build = (): BalanceDialogComponent => {
    const fixture = TestBed.createComponent(BalanceDialogComponent);

    return fixture.componentInstance;
  };

  beforeEach(() => {
    close.mockReset();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideTranslateService(),
        { provide: MAT_DIALOG_DATA, useValue: DATA },
        { provide: MatDialogRef, useValue: { close } },
      ],
    });
  });

  describe('the resulting-balance preview', () => {
    it('shows nothing until an amount is entered', () => {
      expect(build().resulting()).toBeNull();
    });

    it('adds a credit to the pot it targets', () => {
      const component = build();
      component.form.patchValue({ amount: 5 });

      expect(component.resulting()).toBe(19_000);
      expect(component.overdrawn()).toBe(false);
    });

    it('subtracts a debit', () => {
      const component = build();
      component.form.patchValue({ amount: 5, operation: AdminBalanceOperation.DEBIT });

      expect(component.resulting()).toBe(18_000);
    });

    it('follows the chosen pot', () => {
      const component = build();
      component.form.patchValue({ amount: 5, target: AdminBalanceTarget.REFERRAL_BALANCE });

      // The referral pot holds nothing, so the same credit lands differently.
      expect(component.resulting()).toBe(500);
    });

    /**
     * The reason the preview exists. Typing `50` where `5.00` was meant is a
     * tenfold error that no validator catches — it is a perfectly valid amount.
     * Seeing the resulting balance jump is what catches it.
     */
    it('warns when a debit would take the pot below zero', () => {
      const component = build();
      component.form.patchValue({ amount: 500, operation: AdminBalanceOperation.DEBIT });

      expect(component.resulting()).toBe(-31_500);
      expect(component.overdrawn()).toBe(true);
    });
  });

  describe('submit', () => {
    it('refuses an incomplete form rather than closing with a partial request', () => {
      const component = build();
      component.submit();

      expect(close).not.toHaveBeenCalled();
    });

    it('converts the entered USDT to the cents the API takes', () => {
      const component = build();
      component.form.patchValue({ amount: 12.34, reason: 'компенсація' });
      component.submit();

      expect(close).toHaveBeenCalledWith({
        operation: AdminBalanceOperation.CREDIT,
        target: AdminBalanceTarget.BALANCE,
        amountCents: 1234,
        reason: 'компенсація',
      });
    });

    /**
     * `12.34` is 1233.9999… in binary floating point, so truncating would
     * quietly charge a cent less on roughly half of all entries.
     */
    it('rounds rather than truncates', () => {
      const component = build();
      component.form.patchValue({ amount: 0.29, reason: 'x' });
      component.submit();

      expect(close.mock.calls[0][0].amountCents).toBe(29);
    });

    it('trims the reason that reaches the audit row', () => {
      const component = build();
      component.form.patchValue({ amount: 1, reason: '  причина  ' });
      component.submit();

      expect(close.mock.calls[0][0].reason).toBe('причина');
    });
  });
});
