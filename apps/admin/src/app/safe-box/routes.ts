import { Routes } from '@angular/router';
import { provideState } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import { SAFE_BOX_FEATURE, safeBoxCollection, safeBoxEffects } from './store/safe-box.collection';

/** Slice and effects are route-scoped, so an unopened screen costs nothing. */
export const routes: Routes = [
  {
    path: '',
    providers: [
      provideState(SAFE_BOX_FEATURE, safeBoxCollection.reducer),
      provideEffects(safeBoxEffects),
    ],
    loadComponent: () =>
      import('./pages/safe-box-list/safe-box-list.component').then((m) => m.SafeBoxListComponent),
  },
];
