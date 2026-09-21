import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { AdminDocumentDisposition, type AdminDocumentListItem } from '@transacto/contracts';
import { DateTimePipe, UahPipe } from '../../pipes';
import { DocumentFileService } from '../../services';
import { documentRejectionKey, documentStatusPrefix, documentTone } from '../../utils';
import { StatusChipComponent } from '../status-chip/status-chip.component';

/**
 * One archived document, wherever it is shown.
 *
 * Three screens show one — a sale's page, a deposit's page and the archive's
 * own row menu — and the first two had a copy of this markup each. They were
 * not the same copy: the sale's showed no refusal reason and no link to
 * Transacto's own file, and both hard-coded a translation prefix that happened
 * to be right for the kind that screen shows. A shared row is the only version
 * that can be complete, and it is complete for both.
 *
 * Presentational: it takes a row and renders it. Where the bytes are is
 * `DocumentFileService`'s answer, which is the one builder of that URL.
 */
@Component({
  selector: 'app-document-row',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
    TranslatePipe,
    StatusChipComponent,
    UahPipe,
    DateTimePipe,
  ],
  templateUrl: './document-row.component.html',
  styleUrl: './document-row.component.scss',
})
export class DocumentRowComponent {
  readonly document = input.required<AdminDocumentListItem>();

  private readonly files = inject(DocumentFileService);

  readonly tone = computed(() => documentTone(this.document().kind, this.document().status));
  readonly statusPrefix = computed(() => documentStatusPrefix(this.document().kind));

  /**
   * The refusal, in its own kind's words.
   *
   * `null` rather than an empty key when the document was not refused — an
   * unrendered `STATEMENT_REJECTION.null` in a cell is how a missing reason
   * looks like a broken screen.
   */
  readonly rejectionKey = computed(() => {
    const { kind, rejection } = this.document();

    return rejection === null ? null : documentRejectionKey(kind, rejection);
  });

  readonly viewUrl = computed(() => this.files.url(this.document()));
  readonly downloadUrl = computed(() =>
    this.files.url(this.document(), AdminDocumentDisposition.ATTACHMENT),
  );
}
