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
          import('./features/client/layout/client-layout.component').then(
            (m) => m.ClientLayoutComponent,
          ),
        children: [
          { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
          {
            path: 'dashboard',
            loadComponent: () =>
              import('./features/client/dashboard/client-dashboard.component').then(
                (m) => m.ClientDashboardComponent,
              ),
          },
          {
            path: 'transactions',
            loadComponent: () =>
              import('./features/client/transactions/client-transactions.component').then(
                (m) => m.ClientTransactionsComponent,
              ),
          },
          {
            path: 'transfers',
            loadComponent: () =>
              import('./features/client/transfers/client-transfers.component').then(
                (m) => m.ClientTransfersComponent,
              ),
          },
          {
            path: 'loans',
            children: [
              {
                path: '',
                pathMatch: 'full',
                loadComponent: () =>
                  import('./features/client/loans/loans-list/client-loans-list.component').then(
                    (m) => m.ClientLoansListComponent,
                  ),
              },
              {
                path: 'new',
                loadComponent: () =>
                  import('./features/client/loans/loan-form/client-loan-form.component').then(
                    (m) => m.ClientLoanFormComponent,
                  ),
              },
              {
                path: ':id',
                loadComponent: () =>
                  import('./features/client/loans/loan-detail/client-loan-detail.component').then(
                    (m) => m.ClientLoanDetailComponent,
                  ),
              },
            ],
          },
          {
            path: 'profile',
            loadComponent: () =>
              import('./features/client/profile/client-profile.component').then(
                (m) => m.ClientProfileComponent,
              ),
          },
        ],
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
          import('./features/admin/layout/admin-layout.component').then(
            (m) => m.AdminLayoutComponent,
          ),
        children: [
          { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
          {
            path: 'dashboard',
            loadComponent: () =>
              import('./features/admin/dashboard/admin-dashboard.component').then(
                (m) => m.AdminDashboardComponent,
              ),
          },
          {
            path: 'users',
            loadComponent: () =>
              import('./features/admin/users/admin-users.component').then(
                (m) => m.AdminUsersComponent,
              ),
          },
          {
            path: 'transactions',
            loadComponent: () =>
              import('./features/admin/transactions/admin-transactions.component').then(
                (m) => m.AdminTransactionsComponent,
              ),
          },
          {
            path: 'loans',
            loadComponent: () =>
              import('./features/admin/loans/admin-loans.component').then(
                (m) => m.AdminLoansComponent,
              ),
          },
        ],
      },
    ],
  },
  { path: '**', redirectTo: 'login' },
];
