import { Routes } from '@angular/router';

import { authGuard, guestGuard } from './core/guards/auth.guard';
import { roleGuard } from './core/guards/role.guard';
import { UserRole } from './core/models/user.model';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'login' },
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () =>
      import('./features/auth/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'client',
    canActivate: [authGuard, roleGuard(UserRole.CLIENT)],
    canActivateChild: [authGuard, roleGuard(UserRole.CLIENT)],
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./features/client/client-home/client-home.component').then(
            (m) => m.ClientHomeComponent,
          ),
      },
    ],
  },
  {
    path: 'admin',
    canActivate: [authGuard, roleGuard(UserRole.ADMIN)],
    canActivateChild: [authGuard, roleGuard(UserRole.ADMIN)],
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./features/admin/admin-home/admin-home.component').then(
            (m) => m.AdminHomeComponent,
          ),
      },
    ],
  },
  { path: '**', redirectTo: 'login' },
];
