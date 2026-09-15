import { Routes } from '@angular/router';
import { authGuard } from './auth/guards/auth.guard';
import { MainLayoutComponent } from './layout/components/main-layout/main-layout.component';

export const routes: Routes = [
  {
    path: 'login',
    loadChildren: () => import('./auth/routes').then((m) => m.routes),
  },
  {
    // Everything behind the header shell, and behind authentication
    path: '',
    component: MainLayoutComponent,
    canActivate: [authGuard],
    children: [
      { path: '', loadChildren: () => import('./dashboard/routes').then((m) => m.routes) },
      { path: 'history', loadChildren: () => import('./terminal/routes').then((m) => m.routes) },
      { path: 'box', loadChildren: () => import('./safe-box/routes').then((m) => m.routes) },
    ],
  },
  { path: '**', redirectTo: '' },
];
