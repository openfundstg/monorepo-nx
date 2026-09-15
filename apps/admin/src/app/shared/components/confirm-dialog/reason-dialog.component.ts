import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { TranslatePipe } from '@ngx-translate/core';

/** What the caller has to say about the action it is confirming. */
export interface ReasonDialogData {
  /** Translation key. */
  readonly title: string;
  /** Translation key. */
  readonly message: string;
  readonly messageParams?: Record<string, unknown>;
  /** Translation key for the confirm button. */
  readonly confirmLabel: string;
  /** Whether the action takes or moves money, so the button reads as such. */
  readonly destructive?: boolean;
}

/**
 * Confirming an action, with a mandatory reason.
 *
 * The reason is not decoration and the field is not optional: it is written to
 * the audit row, and the backend refuses a request without one. Every
 * intervention in this panel changes somebody's money or access, and an
 * unexplained one is a row nobody can account for a month later.
 *
 * The reason is never shown to the user it concerns — it is operator-facing,
 * which is precisely why it can be candid.
 */
@Component({
  selector: 'app-reason-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    TranslatePipe,
  ],
  templateUrl: './reason-dialog.component.html',
  styleUrl: './reason-dialog.component.scss',
})
export class ReasonDialogComponent {
  /**
   * Read in two steps, deliberately.
   *
   * `MAT_DIALOG_DATA` is an `InjectionToken<any>`, and a type assertion on the
   * `inject()` call supplies a contextual type that TypeScript then tries to
   * infer the token's own parameter from — which fails, because `any` and
   * `ReasonDialogData` are not the same instantiation. Reading it untyped first
   * removes the contextual type, and the assertion applies to a plain value.
   */
  private readonly dialogData = inject(MAT_DIALOG_DATA);
  readonly data = this.dialogData as ReasonDialogData;
  private readonly dialogRef = inject(MatDialogRef<ReasonDialogComponent, string>);

  /** Bounded to the backend's own limit, so the field cannot compose a 400. */
  readonly reason = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.maxLength(500)],
  });

  confirm(): void {
    if (this.reason.invalid) {
      this.reason.markAsTouched();
      return;
    }

    this.dialogRef.close(this.reason.value.trim());
  }
}
