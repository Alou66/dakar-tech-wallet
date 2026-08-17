import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { AuthService } from './auth.service';
import { environment } from '../../../environments/environment';
import { User, UserRole, UserStatus } from '../models/user.model';

const API = environment.apiUrl;

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'u1',
    firstName: 'Fatou',
    lastName: 'Ndiaye',
    email: 'fatou.ndiaye@example.sn',
    phone: '+221771111111',
    accountNumber: 'ACC-0001',
    role: UserRole.CLIENT,
    status: UserStatus.ACTIVE,
    walletBalance: 65000,
    createdAt: '2026-01-10T10:00:00.000Z',
    updatedAt: '2026-01-10T10:00:00.000Z',
    ...overrides,
  };
}

describe('AuthService - login', () => {
  let service: AuthService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  it('connecte un utilisateur ACTIF et le mémorise comme session courante', () => {
    const user = makeUser({ status: UserStatus.ACTIVE });
    let result: User | undefined;

    service.login(user.email).subscribe((u) => (result = u));

    httpMock.expectOne((req) => req.url === `${API}/users` && req.params.get('email') === user.email).flush([user]);

    expect(result).toEqual(user);
    expect(service.currentUser()).toEqual(user);
    expect(service.isAuthenticated()).toBe(true);
  });

  it("11. refuse la connexion d'un utilisateur SUSPENDU et ne le mémorise pas comme session courante", () => {
    const user = makeUser({ status: UserStatus.SUSPENDED });
    let error: Error | undefined;

    service.login(user.email).subscribe({
      error: (err) => (error = err),
    });

    httpMock.expectOne((req) => req.url === `${API}/users` && req.params.get('email') === user.email).flush([user]);

    expect(error?.message).toBe('Votre compte a été suspendu. Contactez un administrateur.');
    expect(service.currentUser()).toBeNull();
    expect(service.isAuthenticated()).toBe(false);
  });

  it("refuse la connexion quand aucun utilisateur ne correspond à l'email", () => {
    let error: Error | undefined;

    service.login('inconnu@example.sn').subscribe({
      error: (err) => (error = err),
    });

    httpMock.expectOne((req) => req.url === `${API}/users`).flush([]);

    expect(error?.message).toBe('Aucun utilisateur trouvé pour cet email.');
    expect(service.currentUser()).toBeNull();
  });
});
