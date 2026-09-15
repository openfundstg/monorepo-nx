import { Routes } from '@angular/router';
import { provideState } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import {
  TERMINALS_FEATURE,
  terminalsCollection,
  terminalsEffects,
} from './store/terminals.collection';

export const routes: Routes = [
  {
    path: '',
    providers: [
      provideState(TERMINALS_FEATURE, terminalsCollection.reducer),
      provideEffects(terminalsEffects),
    ],
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./pages/terminal-list/terminal-list.component').then(
            (m) => m.TerminalListComponent,
          ),
      },
      {
        // `cardId`, not `terminalId`: every terminal has one, and it is what
        // history rows are filed under.
        path: ':cardId/history',
        loadComponent: () =>
          import('./pages/terminal-history/terminal-history.component').then(
            (m) => m.TerminalHistoryComponent,
          ),
      },
    ],
  },
];
