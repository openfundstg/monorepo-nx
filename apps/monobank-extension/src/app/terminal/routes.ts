import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: ':cardId',
    loadComponent: () =>
      import('./pages/terminal-history/terminal-history.component').then(
        (m) => m.TerminalHistoryComponent,
      ),
  },
];
