import { inject } from '@angular/core';
import type { AdminDocumentListItem } from '@transacto/contracts';
import { createCollection, createCollectionEffects } from '../../shared/store';
import { DocumentsApiService } from '../services/documents.api.service';

export const DOCUMENTS_FEATURE = 'documents';

/**
 * The archive.
 *
 * **No live effect, and that is not an omission.** Nothing pushes a document:
 * one appears when somebody uploads it, which is an event the product announces
 * about the sale or the top-up it belongs to rather than about the file. A
 * screen showing files is a screen an operator opens to look something up, not
 * one they sit in front of — and the "N new rows" notice every other list has
 * would be a promise this one cannot keep.
 */
export const documentsCollection = createCollection<AdminDocumentListItem>(DOCUMENTS_FEATURE, {
  defaultSort: 'uploadedAt',
  /**
   * Kind and id, for the reason the deposits book gives: a statement and a
   * receipt come from different collections, each minting its own ObjectId.
   */
  idOf: (row) => `${row.kind}:${row.id}`,
});

export const documentsEffects = createCollectionEffects(documentsCollection, () => {
  const api = inject(DocumentsApiService);

  return (query) => api.list(query);
});
