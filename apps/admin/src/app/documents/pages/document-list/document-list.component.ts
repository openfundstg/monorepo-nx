import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import {
  AdminDocumentDisposition,
  type AdminDocumentListItem,
  type AdminSortDirection,
} from '@transacto/contracts';
import {
  CollectionTableComponent,
  FilterChipsComponent,
  PageHeaderComponent,
  SearchFieldComponent,
  type RowActionEvent,
} from '../../../shared/components';
import type { RowAction } from '../../../shared/interfaces';
import { bindListQuery } from '../../../shared/utils';
import {
  DOCUMENT_COLUMNS,
  DOCUMENT_FILTERS,
} from '../../constants/documents-columns.const';
import { DocumentFileService } from '../../../shared/services';
import { documentsCollection } from '../../store/documents.collection';

/**
 * Ids the list switches on — the same `as const` shape every other list uses.
 *
 * Two of the three open our own copy of a document; the third opens the
 * counterparty's.
 */
const DocumentAction = {
  OPEN: 'open',
  DOWNLOAD: 'download',
  AT_TRANSACTO: 'at-transacto',
} as const;

/**
 * Every file that has passed through this product.
 *
 * **It settles nothing and it is read-only**, which is unusual for a screen in
 * this panel and deliberate: a statement's verdict is reached by the service
 * that read it and a receipt's by its bank's signature and then by Transacto's
 * own recognition. Nothing an operator could do to one of these rows would be
 * an intervention — it would be an edit of evidence.
 *
 * What it offers instead is the two things that were missing: finding a
 * document at all, and knowing what it answered.
 */
@Component({
  selector: 'app-document-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    PageHeaderComponent,
    SearchFieldComponent,
    FilterChipsComponent,
    CollectionTableComponent,
  ],
  templateUrl: './document-list.component.html',
  styleUrl: './document-list.component.scss',
})
export class DocumentListComponent {
  private readonly store = inject(Store);
  private readonly files = inject(DocumentFileService);

  readonly columns = DOCUMENT_COLUMNS;
  readonly filters = DOCUMENT_FILTERS;
  readonly state = this.store.selectSignal(documentsCollection.selectors.selectState);
  /** Row identity, from the collection itself — never guessed from a column. */
  readonly rowId = documentsCollection.idOf;

  /**
   * Opening and saving, hidden on a row with no file.
   *
   * Hidden rather than disabled, for the reason every other menu here hides:
   * an action that is offered and then refused is worse than one that is not
   * offered — and a row whose retention has run out has a column saying so.
   */
  readonly rowActions: readonly RowAction<AdminDocumentListItem>[] = [
    {
      id: DocumentAction.OPEN,
      label: 'documents.open',
      icon: 'visibility',
      visible: (row) => row.fileAvailable,
    },
    {
      id: DocumentAction.DOWNLOAD,
      label: 'documents.download',
      icon: 'download',
      visible: (row) => row.fileAvailable,
    },
    {
      id: DocumentAction.AT_TRANSACTO,
      label: 'documents.at_transacto',
      icon: 'open_in_new',
      visible: (row) => row.externalUrl !== null,
    },
  ];

  constructor() {
    bindListQuery(documentsCollection);
  }

  onSearch(search: string): void {
    this.store.dispatch(documentsCollection.actions.searchChanged({ search }));
  }

  onFilter(slice: string | null): void {
    this.store.dispatch(documentsCollection.actions.filterChanged({ filter: slice }));
  }

  onPage(event: { page: number; limit: number }): void {
    this.store.dispatch(documentsCollection.actions.pageChanged(event));
  }

  onSort(event: { sort: string; direction: AdminSortDirection }): void {
    this.store.dispatch(documentsCollection.actions.sortChanged(event));
  }

  onRefresh(): void {
    this.store.dispatch(documentsCollection.actions.refreshed());
  }

  /**
   * A document is opened by navigating to it, not by fetching it.
   *
   * `window.open` rather than an `<a>` in the menu: the generic table's row
   * actions are buttons that report an id, which is what keeps every list to
   * one table — and a link-shaped exception for this one screen would be the
   * first crack in that.
   */
  onAction({ actionId, row }: RowActionEvent<AdminDocumentListItem>): void {
    const url =
      actionId === DocumentAction.AT_TRANSACTO
        ? row.externalUrl
        : this.files.url(
            row,
            actionId === DocumentAction.DOWNLOAD
              ? AdminDocumentDisposition.ATTACHMENT
              : AdminDocumentDisposition.INLINE,
          );

    if (url === null) return;

    // `noopener` matters: an external URL here is a counterparty's host, and
    // `window.opener` would hand it a handle on the panel.
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
