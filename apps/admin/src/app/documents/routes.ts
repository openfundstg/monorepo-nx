import { Routes } from '@angular/router';
import { provideState } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import {
  DOCUMENTS_FEATURE,
  documentsCollection,
  documentsEffects,
} from './store/documents.collection';

/** Slice and effects are route-scoped, so an unopened screen costs nothing. */
export const routes: Routes = [
  {
    path: '',
    providers: [
      provideState(DOCUMENTS_FEATURE, documentsCollection.reducer),
      provideEffects(documentsEffects),
    ],
    loadComponent: () =>
      import('./pages/document-list/document-list.component').then((m) => m.DocumentListComponent),
  },
];
