import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { TranslatePipe } from '@ngx-translate/core';

/** What the caller is asking the operator to confirm. */
export interface ConfirmDialogData {
  /** Translation key. */
  readonly title: string;
  /** Translation key. Should restate what is about to happen, in figures. */
  readonly message: string;
  readonly messageParams?: Record<string, unknown>;
  /** Translation key for the confirm button. */
  readonly confirmLabel: string;
  /** Whether the action takes or moves money, so the button reads as such. */
  readonly destructive?: boolean;
}

/**
 * A plain yes/no, for an action whose details were already collected.
 *
 * Deliberately separate from {@link ReasonDialogComponent}, which exists to
 * *collect* a reason. Using that one as a confirmation asked for the reason a
 * second time and silently kept only the second answer — the operator typed an
 * explanation, was asked again, and the first one was discarded on the way to
 * the audit row.
 *
 * A confirmation must restate, never re-ask. Everything it shows has already
 * been entered; its only job is to make an irreversible step deliberate.
 */
@Component({
  selector: 'app-confirm-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogModule, MatButtonModule, TranslatePipe],
  templateUrl: './confirm-dialog.component.html',
  styleUrl: './confirm-dialog.component.scss',
})
export class ConfirmDialogComponent {
  private readonly dialogData = inject(MAT_DIALOG_DATA);
  readonly data = this.dialogData as ConfirmDialogData;
}
