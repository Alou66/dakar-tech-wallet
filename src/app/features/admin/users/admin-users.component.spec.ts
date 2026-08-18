import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, UrlTree, provideRouter } from '@angular/router';
import { signal } from '@angular/core';

import { AdminUsersComponent } from './admin-users.component';
import { environment } from '../../../../environments/environment';
import { User, UserRole, UserStatus } from '../../../core/models/user.model';
import { CreditScore, CreditScoreCategory } from '../../../core/models/credit-score.model';
import { roleGuard } from '../../../core/guards/role.guard';
import { AuthService } from '../../../core/services/auth.service';

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

function makeCreditScore(overrides: Partial<CreditScore> = {}): CreditScore {
  return {
    id: 'cs1',
    userId: 'u1',
    score: 68,
    category: CreditScoreCategory.BON,
    totalLoans: 1,
    onTimeRepayments: 2,
    lateRepayments: 0,
    calculatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

interface SetupResult {
  component: AdminUsersComponent;
  httpMock: HttpTestingController;
  fixture: ReturnType<typeof TestBed.createComponent<AdminUsersComponent>>;
}

function setup(): SetupResult {
  TestBed.configureTestingModule({
    imports: [AdminUsersComponent],
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });

  const httpMock = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(AdminUsersComponent);
  const component = fixture.componentInstance;
  fixture.detectChanges();

  return { component, httpMock, fixture };
}

/**
 * Flushe la requête active la plus récente pour chaque appel. Utilise
 * `match()` (qui retire toutes les requêtes correspondantes de la file,
 * y compris celles déjà annulées par un `forkJoin` précédent en erreur)
 * plutôt que `expectOne()`, pour rester robuste après un `retry()`.
 *
 * Les scores de solvabilité sont désormais lus directement depuis
 * `/credit-scores`, déjà tenus à jour côté serveur (voir
 * `DashboardService.getAdminUsersManagement`).
 */
function flushLoad(httpMock: HttpTestingController, users: User[], creditScores: CreditScore[]): void {
  const usersReqs = httpMock.match(`${API}/users`).filter((req) => !req.cancelled);
  expect(usersReqs.length).toBe(1);
  usersReqs[0].flush(users);

  const creditScoreReqs = httpMock.match(`${API}/credit-scores`).filter((req) => !req.cancelled);
  expect(creditScoreReqs.length).toBe(1);
  creditScoreReqs[0].flush(creditScores);
}

describe('AdminUsersComponent', () => {
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  it('1. affiche tous les utilisateurs renvoyés par le service', () => {
    const users = [
      makeUser({ id: 'u1' }),
      makeUser({ id: 'u2', firstName: 'Moussa', lastName: 'Diop', accountNumber: 'ACC-0002' }),
      makeUser({ id: 'u3', role: UserRole.ADMIN, firstName: 'Admin', lastName: 'Système', accountNumber: 'ACC-0000' }),
    ];
    const { component, httpMock } = setup();

    flushLoad(httpMock, users, []);

    expect(component.filteredUsers().length).toBe(3);
    expect(component.hasUsers()).toBe(true);
  });

  it('2. affiche correctement le solde du portefeuille de chaque utilisateur', () => {
    const users = [makeUser({ id: 'u1', walletBalance: 550100 })];
    const { component, fixture, httpMock } = setup();

    flushLoad(httpMock, users, []);
    fixture.detectChanges();

    const expected = component.formatCurrency(550100);
    expect(expected).toContain('550');
    expect(expected).toContain('FCFA');
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain(expected);
  });

  it('3. affiche le score de solvabilité et sa catégorie tels que renvoyés par le serveur', () => {
    const users = [makeUser({ id: 'u1' })];
    const creditScore = makeCreditScore({ userId: 'u1', score: 72, category: CreditScoreCategory.BON });
    const { component, fixture, httpMock } = setup();

    flushLoad(httpMock, users, [creditScore]);
    fixture.detectChanges();

    expect(component.creditScoreFor('u1')?.score).toBe(72);
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('72');
    expect(text).toContain('Bon');
  });

  it("affiche un tiret quand l'utilisateur n'a pas encore de score de solvabilité (aucun prêt)", () => {
    const users = [makeUser({ id: 'u1' })];
    const { component, fixture, httpMock } = setup();

    flushLoad(httpMock, users, []);
    fixture.detectChanges();

    expect(component.creditScoreFor('u1')).toBeUndefined();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('—');
  });

  it('4. filtre les utilisateurs par nom, email ou numéro de compte (recherche)', () => {
    const users = [
      makeUser({ id: 'u1', firstName: 'Fatou', lastName: 'Ndiaye', email: 'fatou.ndiaye@example.sn', accountNumber: 'ACC-0001' }),
      makeUser({ id: 'u2', firstName: 'Moussa', lastName: 'Diop', email: 'moussa.diop@example.sn', accountNumber: 'ACC-0002' }),
    ];
    const { component, httpMock } = setup();

    flushLoad(httpMock, users, []);

    component.searchTerm.set('moussa');
    expect(component.filteredUsers().map((u) => u.id)).toEqual(['u2']);

    component.searchTerm.set('fatou.ndiaye@example.sn');
    expect(component.filteredUsers().map((u) => u.id)).toEqual(['u1']);

    component.searchTerm.set('ACC-0002');
    expect(component.filteredUsers().map((u) => u.id)).toEqual(['u2']);

    component.searchTerm.set('inexistant');
    expect(component.filteredUsers().length).toBe(0);
  });

  it("affiche la date de création de l'utilisateur quand elle est disponible", () => {
    const users = [makeUser({ id: 'u1', createdAt: '2026-02-10T09:00:00.000Z' })];
    const { component, fixture, httpMock } = setup();

    flushLoad(httpMock, users, []);
    fixture.detectChanges();

    expect(component.formatDate('2026-02-10T09:00:00.000Z')).toBe('10/02/2026');
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('10/02/2026');
  });

  it('5. filtre les utilisateurs par rôle', () => {
    const users = [
      makeUser({ id: 'u1', role: UserRole.CLIENT }),
      makeUser({ id: 'u2', role: UserRole.ADMIN, accountNumber: 'ACC-0002' }),
    ];
    const { component, httpMock } = setup();

    flushLoad(httpMock, users, []);

    component.roleFilter.set(UserRole.ADMIN);
    expect(component.filteredUsers().map((u) => u.id)).toEqual(['u2']);

    component.roleFilter.set(UserRole.CLIENT);
    expect(component.filteredUsers().map((u) => u.id)).toEqual(['u1']);

    component.roleFilter.set('ALL');
    expect(component.filteredUsers().length).toBe(2);
  });

  it('6. filtre les utilisateurs par statut', () => {
    const users = [
      makeUser({ id: 'u1', status: UserStatus.ACTIVE }),
      makeUser({ id: 'u2', status: UserStatus.SUSPENDED, accountNumber: 'ACC-0002' }),
    ];
    const { component, httpMock } = setup();

    flushLoad(httpMock, users, []);

    component.statusFilter.set(UserStatus.SUSPENDED);
    expect(component.filteredUsers().map((u) => u.id)).toEqual(['u2']);

    component.statusFilter.set(UserStatus.ACTIVE);
    expect(component.filteredUsers().map((u) => u.id)).toEqual(['u1']);
  });

  it('réinitialise la recherche et les filtres rôle/statut', () => {
    const users = [
      makeUser({ id: 'u1', role: UserRole.CLIENT, status: UserStatus.ACTIVE }),
      makeUser({ id: 'u2', role: UserRole.ADMIN, status: UserStatus.SUSPENDED, accountNumber: 'ACC-0002' }),
    ];
    const { component, httpMock } = setup();

    flushLoad(httpMock, users, []);

    component.searchTerm.set('u1');
    component.roleFilter.set(UserRole.CLIENT);
    component.statusFilter.set(UserStatus.ACTIVE);
    expect(component.hasActiveFilters()).toBe(true);

    component.resetFilters();

    expect(component.searchTerm()).toBe('');
    expect(component.roleFilter()).toBe('ALL');
    expect(component.statusFilter()).toBe('ALL');
    expect(component.hasActiveFilters()).toBe(false);
    expect(component.filteredUsers().length).toBe(2);
  });

  it('7. suspend un utilisateur CLIENT après confirmation', () => {
    const users = [makeUser({ id: 'u1', status: UserStatus.ACTIVE })];
    const { component, httpMock } = setup();

    flushLoad(httpMock, users, []);

    const user = component.filteredUsers()[0];
    component.requestSuspend(user);
    expect(component.pendingAction()).toEqual({ userId: 'u1', action: 'suspend' });

    component.confirmAction();
    expect(component.actionSubmitting()).toBe(true);

    const req = httpMock.expectOne(`${API}/users/u1/suspend`);
    expect(req.request.method).toBe('POST');
    req.flush({ ...user, status: UserStatus.SUSPENDED });

    expect(component.actionSubmitting()).toBe(false);
    expect(component.pendingAction()).toBeNull();
    expect(component.filteredUsers()[0].status).toBe(UserStatus.SUSPENDED);
  });

  it('8. réactive un utilisateur CLIENT suspendu après confirmation', () => {
    const users = [makeUser({ id: 'u1', status: UserStatus.SUSPENDED })];
    const { component, httpMock } = setup();

    flushLoad(httpMock, users, []);

    const user = component.filteredUsers()[0];
    component.requestActivate(user);
    expect(component.pendingAction()).toEqual({ userId: 'u1', action: 'activate' });

    component.confirmAction();

    const req = httpMock.expectOne(`${API}/users/u1/activate`);
    expect(req.request.method).toBe('POST');
    req.flush({ ...user, status: UserStatus.ACTIVE });

    expect(component.filteredUsers()[0].status).toBe(UserStatus.ACTIVE);
    expect(component.pendingAction()).toBeNull();
  });

  it("annule une action en attente sans appeler l'API", () => {
    const users = [makeUser({ id: 'u1', status: UserStatus.ACTIVE })];
    const { component, httpMock } = setup();

    flushLoad(httpMock, users, []);

    component.requestSuspend(component.filteredUsers()[0]);
    component.cancelAction();

    expect(component.pendingAction()).toBeNull();
    httpMock.expectNone(`${API}/users/u1/suspend`);
  });

  it("9. un ADMIN ne peut jamais être suspendu ou réactivé depuis cet écran", () => {
    const users = [makeUser({ id: 'u1', role: UserRole.ADMIN, status: UserStatus.ACTIVE })];
    const { component, httpMock } = setup();

    flushLoad(httpMock, users, []);

    const admin = component.filteredUsers()[0];
    expect(component.isClient(admin)).toBe(false);

    component.requestSuspend(admin);
    expect(component.pendingAction()).toBeNull();

    component.requestActivate(admin);
    expect(component.pendingAction()).toBeNull();

    httpMock.expectNone(`${API}/users/u1/suspend`);
    httpMock.expectNone(`${API}/users/u1/activate`);
  });

  it('10. affiche une erreur quand le chargement échoue, avec possibilité de réessayer', () => {
    const { component, httpMock } = setup();

    httpMock.expectOne(`${API}/users`).flush('Erreur serveur', { status: 500, statusText: 'Server Error' });

    expect(component.error()).toBe('Impossible de charger la liste des utilisateurs.');
    expect(component.loading()).toBe(false);

    component.retry();
    expect(component.loading()).toBe(true);

    flushLoad(httpMock, [makeUser({ id: 'u1' })], []);
    expect(component.error()).toBeNull();
    expect(component.filteredUsers().length).toBe(1);
  });

  it("gère l'échec de la mise à jour du statut sans modifier la liste", () => {
    const users = [makeUser({ id: 'u1', status: UserStatus.ACTIVE })];
    const { component, httpMock } = setup();

    flushLoad(httpMock, users, []);

    component.requestSuspend(component.filteredUsers()[0]);
    component.confirmAction();

    httpMock.expectOne(`${API}/users/u1/suspend`).flush('Erreur', { status: 500, statusText: 'Server Error' });

    expect(component.actionError()).toBe(
      "Impossible de mettre à jour le statut de l'utilisateur. Veuillez réessayer.",
    );
    expect(component.actionSubmitting()).toBe(false);
    expect(component.filteredUsers()[0].status).toBe(UserStatus.ACTIVE);
  });

  it('11. affiche un état vide quand aucun utilisateur n’existe', () => {
    const { component, fixture, httpMock } = setup();

    flushLoad(httpMock, [], []);
    fixture.detectChanges();

    expect(component.hasUsers()).toBe(false);
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Aucun utilisateur enregistré pour le moment.');
  });

  it("affiche un état vide spécifique quand aucun utilisateur ne correspond aux filtres", () => {
    const users = [makeUser({ id: 'u1' })];
    const { component, fixture, httpMock } = setup();

    flushLoad(httpMock, users, []);
    component.searchTerm.set('inexistant');
    fixture.detectChanges();

    expect(component.hasFilteredResults()).toBe(false);
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Aucun utilisateur ne correspond à ces critères.');
  });

  it('12. affiche un indicateur de chargement pendant la requête initiale', () => {
    const { component, httpMock } = setup();

    expect(component.loading()).toBe(true);

    flushLoad(httpMock, [], []);
    expect(component.loading()).toBe(false);
  });
});

/** 13. La route /admin/users hérite de la protection `roleGuard(UserRole.ADMIN)` posée sur `/admin` (canActivateChild). */
describe("AdminUsersComponent - accès réservé à ADMIN (roleGuard sur /admin/users)", () => {
  function runGuard(currentUser: User | null): boolean | UrlTree {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { currentUser: signal(currentUser) } },
      ],
    });

    let result!: boolean | UrlTree;
    TestBed.runInInjectionContext(() => {
      result = roleGuard(UserRole.ADMIN)({} as never, { url: '/admin/users' } as never) as boolean | UrlTree;
    });
    return result;
  }

  it("redirige vers /login quand personne n'est connecté", () => {
    const result = runGuard(null);
    const router = TestBed.inject(Router);

    expect(result instanceof UrlTree).toBe(true);
    expect(router.serializeUrl(result as UrlTree)).toBe('/login');
  });

  it('refuse l’accès à un utilisateur CLIENT et le redirige vers son espace', () => {
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
