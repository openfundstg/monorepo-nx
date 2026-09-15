import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { TranslatePipe } from '@ngx-translate/core';
import { formatUah, formatUsdt } from '../../utils/format.util';

/** What the operator is stopping, and what the product would pay for it. */
export interface RefundDialogData {
  /** Translation key for the title — cancelling and releasing differ. */
  readonly title: string;
  /** Translation key for the line above the form. */
  readonly message: string;
  readonly messageParams?: Record<string, unknown>;
  readonly confirmLabel: string;
  /** USDT cents staked against the order. The refund cannot exceed it. */
  readonly frozenUsdt: number;
  /** USDT cents the automatic split would return. */
  readonly suggestedRefundCents: number;
  /** UAH kopecks the jar has already delivered, for context. */
  readonly receivedAmount: number;
}

/** What the caller gets back: the refund in cents, and the reason for it. */
export interface RefundDialogResult {
  readonly refundCents: number;
  readonly reason: string;
}

/**
 * Stopping an order and deciding what goes back.
 *
 * The amount is **prefilled with the figure the product would have used** — the
 * stake less whatever the jar already delivered, computed server-side by the
 * same helper the settlement runs. An operator who agrees with it changes
 * nothing; one who is here precisely because it is wrong types over it.
 *
 * That prefill is the whole design. An empty field would make every routine
 * cancellation an arithmetic exercise, and arithmetic done by hand on somebody
 * else's money is where the mistakes are.
 */
@Component({
  selector: 'app-refund-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    TranslatePipe,
  ],
  templateUrl: './refund-dialog.component.html',
  styleUrl: './refund-dialog.component.scss',
})
export class RefundDialogComponent {
  private readonly dialogData = inject(MAT_DIALOG_DATA);
  readonly data = this.dialogData as RefundDialogData;

  private readonly dialogRef = inject(MatDialogRef<RefundDialogComponent, RefundDialogResult>);
  private readonly fb = inject(FormBuilder);

  readonly form = this.fb.nonNullable.group({
    // In USDT, not cents — nobody types cents. Converted on submit.
    refund: [this.data.suggestedRefundCents / 100, [Validators.required, Validators.min(0)]],
    reason: ['', [Validators.required, Validators.maxLength(500)]],
  });

  private readonly value = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue(),
  });

  readonly stake = formatUsdt(this.data.frozenUsdt);
  readonly suggested = formatUsdt(this.data.suggestedRefundCents);
  readonly received = formatUah(this.data.receivedAmount);

  /** Cents, as the API takes them — and as the bounds below are expressed. */
  private readonly refundCents = computed(() => {
    const refund = this.value().refund;

    return refund === null || refund === undefined || !Number.isFinite(refund)
      ? null
      : Math.round(refund * 100);
  });

  /**
   * Whether the figure exceeds the stake.
   *
   * The server refuses this outright — unfreezing more than was frozen leaves
   * the user's frozen pot permanently wrong — so this only explains the refusal
   * before it costs a round trip. Paying somebody more than their stake is a
   * balance correction, which is its own action.
   */
  readonly exceedsStake = computed(() => (this.refundCents() ?? 0) > this.data.frozenUsdt);

  /** What the operator's figure differs from, so a deliberate override is visible. */
  readonly isOverridden = computed(() => this.refundCents() !== this.data.suggestedRefundCents);

  submit(): void {
    if (this.form.invalid || this.exceedsStake()) {
      this.form.markAllAsTouched();
      return;
    }

    this.dialogRef.close({
      refundCents: this.refundCents() ?? 0,
      reason: this.form.getRawValue().reason.trim(),
    });
  }
}
