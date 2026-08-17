import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, UrlTree, provideRouter } from '@angular/router';
import { signal } from '@angular/core';

import { AdminTransactionsComponent } from './admin-transactions.component';
import { environment } from '../../../../environments/environment';
import { Transaction, TransactionStatus, TransactionType } from '../../../core/models/transaction.model';
import { User, UserRole, UserStatus } from '../../../core/models/user.model';
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

function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx1',
    type: TransactionType.VIREMENT,
    status: TransactionStatus.REUSSIE,
    amount: 5000,
    senderId: 'u1',
    receiverId: 'u2',
    description: 'Virement test',
    createdAt: '2026-03-10T10:00:00.000Z',
    ...overrides,
  };
}

interface SetupResult {
  component: AdminTransactionsComponent;
  httpMock: HttpTestingController;
  fixture: ReturnType<typeof TestBed.createComponent<AdminTransactionsComponent>>;
}

function setup(): SetupResult {
  TestBed.configureTestingModule({
    imports: [AdminTransactionsComponent],
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });

  const httpMock = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(AdminTransactionsComponent);
  const component = fixture.componentInstance;
  fixture.detectChanges();

  return { component, httpMock, fixture };
}

/**
 * Flushe la requête active la plus récente pour chaque appel. Utilise
 * `match()` (qui retire toutes les requêtes correspondantes de la file,
 * y compris celles déjà annulées par un `forkJoin` précédent en erreur)
 * plutôt que `expectOne()`, pour rester robuste après un `retry()`.
 */
function flushLoad(httpMock: HttpTestingController, transactions: Transaction[], users: User[]): void {
  const txReqs = httpMock.match(`${API}/transactions`).filter((req) => !req.cancelled);
  expect(txReqs.length).toBe(1);
  txReqs[0].flush(transactions);

  const usersReqs = httpMock.match(`${API}/users`).filter((req) => !req.cancelled);
  expect(usersReqs.length).toBe(1);
  usersReqs[0].flush(users);
}

describe('AdminTransactionsComponent', () => {
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  it('1. affiche toutes les transactions renvoyées par le service', () => {
    const users = [makeUser({ id: 'u1' }), makeUser({ id: 'u2', accountNumber: 'ACC-0002' })];
    const transactions = [
      makeTransaction({ id: 'tx1' }),
      makeTransaction({ id: 'tx2', type: TransactionType.DEPOT, senderId: undefined }),
      makeTransaction({ id: 'tx3', type: TransactionType.RETRAIT, receiverId: undefined }),
    ];
    const { component, httpMock } = setup();

    flushLoad(httpMock, transactions, users);

    expect(component.filteredTransactions().length).toBe(3);
    expect(component.hasTransactions()).toBe(true);
  });

  it('2. résout correctement le nom et le numéro de compte des utilisateurs liés', () => {
    const users = [
      makeUser({ id: 'u1', firstName: 'Fatou', lastName: 'Ndiaye', accountNumber: 'ACC-0001' }),
      makeUser({ id: 'u2', firstName: 'Moussa', lastName: 'Diop', accountNumber: 'ACC-0002' }),
    ];
    const transactions = [makeTransaction({ id: 'tx1', senderId: 'u1', receiverId: 'u2' })];
    const { component, fixture, httpMock } = setup();

    flushLoad(httpMock, transactions, users);
    fixture.detectChanges();

    expect(component.userLabel('u1')).toBe('Fatou Ndiaye');
    expect(component.userAccountNumber('u1')).toBe('ACC-0001');
    expect(component.userLabel('u2')).toBe('Moussa Diop');
    expect(component.userAccountNumber('u2')).toBe('ACC-0002');

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Fatou Ndiaye');
    expect(text).toContain('ACC-0001');
    expect(text).toContain('Moussa Diop');
    expect(text).toContain('ACC-0002');
  });

  it("affiche un tiret quand la transaction n'a pas d'expéditeur ou de bénéficiaire", () => {
    const users = [makeUser({ id: 'u1' })];
    const transactions = [makeTransaction({ id: 'tx1', type: TransactionType.DEPOT, senderId: undefined, receiverId: 'u1' })];
    const { component, httpMock } = setup();

    flushLoad(httpMock, transactions, users);

    expect(component.userLabel(undefined)).toBe('—');
    expect(component.userAccountNumber(undefined)).toBeUndefined();
  });

  it('3. filtre les transactions par nom, email ou numéro de compte (recherche)', () => {
    const users = [
      makeUser({ id: 'u1', firstName: 'Fatou', lastName: 'Ndiaye', email: 'fatou.ndiaye@example.sn', accountNumber: 'ACC-0001' }),
      makeUser({ id: 'u2', firstName: 'Moussa', lastName: 'Diop', email: 'moussa.diop@example.sn', accountNumber: 'ACC-0002' }),
    ];
    const transactions = [
      makeTransaction({ id: 'tx1', senderId: 'u1', receiverId: 'u2' }),
      makeTransaction({ id: 'tx2', senderId: 'u2', receiverId: 'u1' }),
    ];
    const { component, httpMock } = setup();

    flushLoad(httpMock, transactions, users);

    component.searchTerm.set('moussa');
    expect(component.filteredTransactions().map((t) => t.id).sort()).toEqual(['tx1', 'tx2']);

    component.searchTerm.set('fatou.ndiaye@example.sn');
    expect(component.filteredTransactions().map((t) => t.id).sort()).toEqual(['tx1', 'tx2']);

    component.searchTerm.set('inexistant');
    expect(component.filteredTransactions().length).toBe(0);
  });

  it('4. filtre les transactions par type', () => {
    const users = [makeUser({ id: 'u1' }), makeUser({ id: 'u2', accountNumber: 'ACC-0002' })];
    const transactions = [
      makeTransaction({ id: 'tx1', type: TransactionType.DEPOT, senderId: undefined }),
      makeTransaction({ id: 'tx2', type: TransactionType.RETRAIT, receiverId: undefined }),
    ];
    const { component, httpMock } = setup();

    flushLoad(httpMock, transactions, users);

    component.typeFilter.set(TransactionType.DEPOT);
    expect(component.filteredTransactions().map((t) => t.id)).toEqual(['tx1']);

    component.typeFilter.set(TransactionType.RETRAIT);
    expect(component.filteredTransactions().map((t) => t.id)).toEqual(['tx2']);

    component.typeFilter.set('ALL');
    expect(component.filteredTransactions().length).toBe(2);
  });

  it('5. filtre les transactions par statut', () => {
    const users = [makeUser({ id: 'u1' }), makeUser({ id: 'u2', accountNumber: 'ACC-0002' })];
    const transactions = [
      makeTransaction({ id: 'tx1', status: TransactionStatus.REUSSIE }),
      makeTransaction({ id: 'tx2', status: TransactionStatus.ECHOUEE }),
    ];
    const { component, httpMock } = setup();

    flushLoad(httpMock, transactions, users);

    component.statusFilter.set(TransactionStatus.ECHOUEE);
    expect(component.filteredTransactions().map((t) => t.id)).toEqual(['tx2']);

    component.statusFilter.set(TransactionStatus.REUSSIE);
    expect(component.filteredTransactions().map((t) => t.id)).toEqual(['tx1']);
  });

  it('filtre les transactions par période (date de début / de fin)', () => {
    const users = [makeUser({ id: 'u1' }), makeUser({ id: 'u2', accountNumber: 'ACC-0002' })];
    const transactions = [
      makeTransaction({ id: 'tx1', createdAt: '2026-01-05T10:00:00.000Z' }),
      makeTransaction({ id: 'tx2', createdAt: '2026-03-15T10:00:00.000Z' }),
      makeTransaction({ id: 'tx3', createdAt: '2026-06-20T10:00:00.000Z' }),
    ];
    const { component, httpMock } = setup();

    flushLoad(httpMock, transactions, users);

    component.dateFrom.set('2026-02-01');
    expect(component.filteredTransactions().map((t) => t.id).sort()).toEqual(['tx2', 'tx3']);

    component.dateTo.set('2026-04-01');
    expect(component.filteredTransactions().map((t) => t.id)).toEqual(['tx2']);
  });

  it('6. combine plusieurs filtres simultanément', () => {
    const users = [
      makeUser({ id: 'u1', firstName: 'Fatou', lastName: 'Ndiaye', accountNumber: 'ACC-0001' }),
      makeUser({ id: 'u2', firstName: 'Moussa', lastName: 'Diop', accountNumber: 'ACC-0002' }),
    ];
    const transactions = [
      makeTransaction({ id: 'tx1', type: TransactionType.VIREMENT, status: TransactionStatus.REUSSIE, senderId: 'u1', receiverId: 'u2' }),
      makeTransaction({ id: 'tx2', type: TransactionType.VIREMENT, status: TransactionStatus.ECHOUEE, senderId: 'u1', receiverId: 'u2' }),
      makeTransaction({ id: 'tx3', type: TransactionType.DEPOT, status: TransactionStatus.REUSSIE, senderId: undefined, receiverId: 'u2' }),
    ];
    const { component, httpMock } = setup();

    flushLoad(httpMock, transactions, users);

    component.typeFilter.set(TransactionType.VIREMENT);
    component.statusFilter.set(TransactionStatus.REUSSIE);
    component.searchTerm.set('fatou');

    expect(component.filteredTransactions().map((t) => t.id)).toEqual(['tx1']);
  });

  it('7. réinitialise tous les filtres actifs', () => {
    const users = [makeUser({ id: 'u1' }), makeUser({ id: 'u2', accountNumber: 'ACC-0002' })];
    const transactions = [makeTransaction({ id: 'tx1' }), makeTransaction({ id: 'tx2', type: TransactionType.DEPOT, senderId: undefined })];
    const { component, httpMock } = setup();

    flushLoad(httpMock, transactions, users);

    component.searchTerm.set('fatou');
    component.typeFilter.set(TransactionType.DEPOT);
    component.statusFilter.set(TransactionStatus.REUSSIE);
    component.dateFrom.set('2026-01-01');
    component.dateTo.set('2026-12-31');
    expect(component.hasActiveFilters()).toBe(true);

    component.resetFilters();

    expect(component.hasActiveFilters()).toBe(false);
    expect(component.searchTerm()).toBe('');
    expect(component.typeFilter()).toBe('ALL');
    expect(component.statusFilter()).toBe('ALL');
    expect(component.dateFrom()).toBe('');
    expect(component.dateTo()).toBe('');
    expect(component.filteredTransactions().length).toBe(2);
  });

  it('8. affiche un état vide quand aucune transaction n’existe', () => {
    const { component, fixture, httpMock } = setup();

    flushLoad(httpMock, [], []);
    fixture.detectChanges();

    expect(component.hasTransactions()).toBe(false);
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Aucune transaction enregistrée pour le moment.');
  });

  it('affiche un état vide spécifique quand aucune transaction ne correspond aux filtres', () => {
    const users = [makeUser({ id: 'u1' }), makeUser({ id: 'u2', accountNumber: 'ACC-0002' })];
    const transactions = [makeTransaction({ id: 'tx1' })];
    const { component, fixture, httpMock } = setup();

    flushLoad(httpMock, transactions, users);
    component.searchTerm.set('inexistant');
    fixture.detectChanges();

    expect(component.hasFilteredResults()).toBe(false);
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Aucune transaction ne correspond à ces critères.');
  });

  it('9. affiche une erreur quand le chargement échoue, avec possibilité de réessayer', () => {
    const { component, httpMock } = setup();

    httpMock.expectOne(`${API}/transactions`).flush('Erreur serveur', { status: 500, statusText: 'Server Error' });

    expect(component.error()).toBe('Impossible de charger les transactions.');
    expect(component.loading()).toBe(false);

    component.retry();
    expect(component.loading()).toBe(true);

    flushLoad(httpMock, [makeTransaction({ id: 'tx1' })], [makeUser({ id: 'u1' }), makeUser({ id: 'u2', accountNumber: 'ACC-0002' })]);
    expect(component.error()).toBeNull();
    expect(component.filteredTransactions().length).toBe(1);
  });

  it('10. affiche un indicateur de chargement pendant la requête initiale', () => {
    const { component, httpMock } = setup();

    expect(component.loading()).toBe(true);

    flushLoad(httpMock, [], []);
    expect(component.loading()).toBe(false);
  });
});

/** 11. La route /admin/transactions hérite de la protection `roleGuard(UserRole.ADMIN)` posée sur `/admin` (canActivateChild). */
describe("AdminTransactionsComponent - accès réservé à ADMIN (roleGuard sur /admin/transactions)", () => {
  function runGuard(currentUser: User | null): boolean | UrlTree {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { currentUser: signal(currentUser) } },
      ],
    });

    let result!: boolean | UrlTree;
    TestBed.runInInjectionContext(() => {
      result = roleGuard(UserRole.ADMIN)({} as never, { url: '/admin/transactions' } as never) as boolean | UrlTree;
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
