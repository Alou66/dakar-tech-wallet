import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { UserRole, UserStatus } from '../models/user.model';
import { AuthService } from '../services/auth.service';

/** URL de l'espace correspondant au rôle d'un utilisateur connecté. */
export function spaceUrlForRole(role: UserRole): string {
  return role === UserRole.ADMIN ? '/admin' : '/client';
}

/**
 * Bloque l'accès aux routes protégées si aucun utilisateur n'est connecté,
 * ou si le compte connu localement a été suspendu (ex: session ouverte
 * avant une suspension) : la session est alors invalidée.
 */
export const authGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  const user = authService.currentUser();
  if (!user) {
    return router.createUrlTree(['/login']);
  }

  if (user.status === UserStatus.SUSPENDED) {
    authService.logout();
    return router.createUrlTree(['/login']);
  }

  return true;
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
