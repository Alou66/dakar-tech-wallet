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

  it('connecte un utilisateur avec un email/mot de passe valides et mémorise le token et la session', () => {
    const user = makeUser({ status: UserStatus.ACTIVE });
    let result: User | undefined;

    service.login(user.email, 'password123').subscribe((u) => (result = u));

    const req = httpMock.expectOne(`${API}/auth/login`);
    expect(req.request.body).toEqual({ email: user.email, password: 'password123' });
    req.flush({ token: 'fake-jwt-token', user });

    expect(result).toEqual(user);
    expect(service.currentUser()).toEqual(user);
    expect(service.isAuthenticated()).toBe(true);
    expect(service.getToken()).toBe('fake-jwt-token');
  });

  it('refuse la connexion avec des identifiants invalides et ne mémorise aucune session', () => {
    let error: unknown;

    service.login('fatou.ndiaye@example.sn', 'wrong-password').subscribe({
      error: (err) => (error = err),
    });

    httpMock.expectOne(`${API}/auth/login`).flush(
      { message: 'Email ou mot de passe incorrect.' },
      { status: 401, statusText: 'Unauthorized' },
    );

    expect(error).toBeTruthy();
    expect(service.currentUser()).toBeNull();
    expect(service.isAuthenticated()).toBe(false);
    expect(service.getToken()).toBeNull();
  });
});

describe('AuthService - register', () => {
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

  it('inscrit un client et ouvre automatiquement la session', () => {
    const user = makeUser({ accountNumber: 'ACC-0004' });
    const request = {
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phone: user.phone,
      password: 'password123',
    };
    let result: User | undefined;

    service.register(request).subscribe((u) => (result = u));

    const req = httpMock.expectOne(`${API}/auth/register`);
    expect(req.request.body).toEqual(request);
    req.flush({ token: 'fake-jwt-token', user });

    expect(result).toEqual(user);
    expect(service.currentUser()).toEqual(user);
    expect(service.isAuthenticated()).toBe(true);
    expect(service.getToken()).toBe('fake-jwt-token');
  });

  it('refuse l\'inscription avec un email déjà utilisé et ne mémorise aucune session', () => {
    const request = {
      firstName: 'Awa',
      lastName: 'Sarr',
      email: 'fatou.ndiaye@example.sn',
      phone: '+221773334455',
      password: 'password123',
    };
    let error: unknown;

    service.register(request).subscribe({
      error: (err) => (error = err),
    });

    httpMock.expectOne(`${API}/auth/register`).flush(
      { message: 'Un compte existe déjà avec cet email.' },
      { status: 409, statusText: 'Conflict' },
    );

    expect(error).toBeTruthy();
    expect(service.currentUser()).toBeNull();
    expect(service.isAuthenticated()).toBe(false);
    expect(service.getToken()).toBeNull();
  });
});
