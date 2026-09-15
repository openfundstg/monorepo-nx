import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { TranslatePipe } from '@ngx-translate/core';
import {
  AdminBalanceOperation,
  AdminBalanceTarget,
  type AdminAdjustBalanceReq,
} from '@transacto/contracts';
import { formatUsdt } from '../../utils/format.util';

/** The account being corrected, so the dialog can show what is there now. */
export interface BalanceDialogData {
  readonly username: string;
  /** USDT cents. */
  readonly balance: number;
  readonly referralBalance: number;
}

/**
 * A manual balance correction.
 *
 * The riskiest thing in the panel, and the form is shaped to say so. The
 * direction is a choice, never a sign — a negative number typed into an
 * "amount" field is a debit that reads as a credit in every log that follows
 * it. Amounts are entered in USDT and converted to cents on submit, because
 * cents are the wire unit and nobody types them.
 */
@Component({
  selector: 'app-balance-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    TranslatePipe,
  ],
  templateUrl: './balance-dialog.component.html',
  styleUrl: './balance-dialog.component.scss',
})
export class BalanceDialogComponent {
  /**
   * Read in two steps, deliberately.
   *
   * `MAT_DIALOG_DATA` is an `InjectionToken<any>`, and a type assertion on the
   * `inject()` call supplies a contextual type that TypeScript then tries to
   * infer the token's own parameter from — which fails, because `any` and
   * `BalanceDialogData` are not the same instantiation. Reading it untyped first
   * removes the contextual type, and the assertion applies to a plain value.
   */
  private readonly dialogData = inject(MAT_DIALOG_DATA);
  readonly data = this.dialogData as BalanceDialogData;
  private readonly dialogRef = inject(MatDialogRef<BalanceDialogComponent, AdminAdjustBalanceReq>);
  private readonly fb = inject(FormBuilder);

  protected readonly AdminBalanceOperation = AdminBalanceOperation;
  protected readonly AdminBalanceTarget = AdminBalanceTarget;

  readonly form = this.fb.nonNullable.group({
    operation: [AdminBalanceOperation.CREDIT, Validators.required],
    target: [AdminBalanceTarget.BALANCE, Validators.required],
    /**
     * In USDT, not cents. `min` is one cent expressed in that unit, so the
     * smallest accepted entry is the smallest amount the backend will take.
     */
    amount: [null as number | null, [Validators.required, Validators.min(0.01)]],
    reason: ['', [Validators.required, Validators.maxLength(500)]],
  });

  readonly balances = [
    { target: AdminBalanceTarget.BALANCE, label: 'users.balance', value: this.data.balance },
    {
      target: AdminBalanceTarget.REFERRAL_BALANCE,
      label: 'users.referral_balance',
      value: this.data.referralBalance,
    },
  ];

  /**
   * The form as a signal, so the preview below recomputes as it is typed.
   *
   * `toSignal` over `valueChanges` rather than an `effect`: this derives a
   * value, and a derived value is a `computed`, not a side effect that writes
   * another signal.
   */
  private readonly value = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue(),
  });

  /**
   * What the chosen pot will hold afterwards, or `null` while the amount is not
   * yet a usable number.
   *
   * Shown live because this is where a misplaced decimal point is catchable —
   * the operator types `50` meaning `5.00` and sees the result jump by ten
   * times before committing to anything. The confirmation that follows restates
   * this figure; it is not the first place it appears.
   */
  readonly resulting = computed<number | null>(() => {
    const { operation, target, amount } = this.value();
    if (amount === null || amount === undefined || !Number.isFinite(amount) || amount <= 0)
      return null;

    const current =
      target === AdminBalanceTarget.REFERRAL_BALANCE
        ? this.data.referralBalance
        : this.data.balance;
    const cents = Math.round(amount * 100);

    return operation === AdminBalanceOperation.DEBIT ? current - cents : current + cents;
  });

  /**
   * Whether the debit asks for more than the pot holds.
   *
   * The server refuses this with a `409` — its `$gte` guard is what makes the
   * debit safe under concurrency — so this is not the check, only the warning
   * that saves a round trip and explains the refusal before it happens.
   */
  readonly overdrawn = computed(() => (this.resulting() ?? 0) < 0);

  format(cents: number): string {
    return formatUsdt(cents);
  }

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const { operation, target, amount, reason } = this.form.getRawValue();

    this.dialogRef.close({
      operation,
      target,
      // Rounded rather than truncated: `12.34` in binary floating point is
      // 1233.9999…, and `Math.trunc` would quietly charge a cent less on
      // roughly half of all entries.
      amountCents: Math.round((amount ?? 0) * 100),
      reason: reason.trim(),
    });
  }
}
