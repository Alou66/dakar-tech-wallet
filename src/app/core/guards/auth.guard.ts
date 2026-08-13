import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { UserRole } from '../models/user.model';
import { AuthService } from '../services/auth.service';

/** URL de l'espace correspondant au rôle d'un utilisateur connecté. */
export function spaceUrlForRole(role: UserRole): string {
  return role === UserRole.ADMIN ? '/admin' : '/client';
}

/** Bloque l'accès aux routes protégées si aucun utilisateur n'est connecté. */
export const authGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (authService.isAuthenticated()) {
    return true;
  }

  return router.createUrlTree(['/login']);
};

/** Empêche un utilisateur déjà connecté de revoir la page de login. */
export const guestGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);
  const user = authService.currentUser();

  if (!user) {
    return true;
  }

  return router.createUrlTree([spaceUrlForRole(user.role)]);
};
