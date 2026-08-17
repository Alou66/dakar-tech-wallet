import { TestBed } from '@angular/core/testing';
import { Router, UrlTree, provideRouter } from '@angular/router';
import { signal } from '@angular/core';

import { authGuard } from './auth.guard';
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

describe('authGuard', () => {
  function runGuard(currentUser: User | null): { result: boolean | UrlTree; logoutCalls: number } {
    let logoutCalls = 0;

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: AuthService,
          useValue: { currentUser: signal(currentUser), logout: () => (logoutCalls += 1) },
        },
      ],
    });

    let result!: boolean | UrlTree;
    TestBed.runInInjectionContext(() => {
      result = authGuard({} as never, { url: '/client/dashboard' } as never) as boolean | UrlTree;
    });
    return { result, logoutCalls };
  }

  it("redirige vers /login quand personne n'est connecté", () => {
    const { result } = runGuard(null);
    const router = TestBed.inject(Router);

    expect(result instanceof UrlTree).toBe(true);
    expect(router.serializeUrl(result as UrlTree)).toBe('/login');
  });

  it('autorise un utilisateur ACTIF', () => {
    const { result, logoutCalls } = runGuard(makeUser({ status: UserStatus.ACTIVE }));

    expect(result).toBe(true);
    expect(logoutCalls).toBe(0);
  });

  it("11. bloque et déconnecte un utilisateur SUSPENDU, puis le redirige vers /login", () => {
    const { result, logoutCalls } = runGuard(makeUser({ status: UserStatus.SUSPENDED }));
    const router = TestBed.inject(Router);

    expect(result instanceof UrlTree).toBe(true);
    expect(router.serializeUrl(result as UrlTree)).toBe('/login');
    expect(logoutCalls).toBe(1);
  });
});
