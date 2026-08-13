import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { UserRole } from '../models/user.model';
import { AuthService } from '../services/auth.service';
import { spaceUrlForRole } from './auth.guard';

/**
 * Restreint une route au rôle attendu. Redirige vers /login si personne n'est
 * connecté, ou vers l'espace de l'utilisateur si son rôle ne correspond pas.
 */
export const roleGuard = (requiredRole: UserRole): CanActivateFn => {
  return () => {
    const authService = inject(AuthService);
    const router = inject(Router);
    const user = authService.currentUser();

    if (!user) {
      return router.createUrlTree(['/login']);
    }

    if (user.role !== requiredRole) {
      return router.createUrlTree([spaceUrlForRole(user.role)]);
    }

    return true;
  };
};
