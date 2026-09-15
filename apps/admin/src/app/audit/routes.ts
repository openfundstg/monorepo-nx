import { Routes } from '@angular/router';
import { provideState } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import { AUDIT_FEATURE, auditCollection, auditEffects } from './store/audit.collection';

/** Slice and effects are route-scoped, so an unopened screen costs nothing. */
export const routes: Routes = [
  {
    path: '',
    providers: [provideState(AUDIT_FEATURE, auditCollection.reducer), provideEffects(auditEffects)],
    loadComponent: () =>
      import('./pages/audit-list/audit-list.component').then((m) => m.AuditListComponent),
  },
];
