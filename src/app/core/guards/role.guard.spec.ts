import { TestBed } from '@angular/core/testing';
import { Router, UrlTree, provideRouter } from '@angular/router';
import { signal } from '@angular/core';

import { roleGuard } from './role.guard';
import { AuthService } from '../services/auth.service';
import { User, UserRole, UserStatus } from '../models/user.model';

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'u1',
    firstName: 'Test',
    lastName: 'User',
    email: 'test@example.sn',
    phone: '+221770000000',
    accountNumber: 'ACC-0001',
    role: UserRole.CLIENT,
    status: UserStatus.ACTIVE,
    walletBalance: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Le tableau de bord admin est protégé par `roleGuard(UserRole.ADMIN)` sur la route /admin. */
describe("roleGuard(ADMIN) - accès au tableau de bord administrateur", () => {
  function runGuard(currentUser: User | null): boolean | UrlTree {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { currentUser: signal(currentUser) } },
      ],
    });

    let result!: boolean | UrlTree;
    TestBed.runInInjectionContext(() => {
      result = roleGuard(UserRole.ADMIN)(
        {} as never,
        { url: '/admin/dashboard' } as never,
      ) as boolean | UrlTree;
    });
    return result;
  }

  it("redirige vers /login quand personne n'est connecté", () => {
    const result = runGuard(null);
    const router = TestBed.inject(Router);

    expect(result instanceof UrlTree).toBe(true);
    expect(router.serializeUrl(result as UrlTree)).toBe('/login');
  });

  it("refuse l'accès à un utilisateur CLIENT et le redirige vers son espace", () => {
    const result = runGuard(makeUser({ role: UserRole.CLIENT }));
    const router = TestBed.inject(Router);

    expect(result instanceof UrlTree).toBe(true);
    expect(router.serializeUrl(result as UrlTree)).toBe('/client');
  });

  it('autorise un utilisateur ADMIN', () => {
    const result = runGuard(makeUser({ role: UserRole.ADMIN }));

    expect(result).toBe(true);
  });
});
