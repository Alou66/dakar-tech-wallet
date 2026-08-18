import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, UrlTree, provideRouter } from '@angular/router';
import { signal } from '@angular/core';

import { AdminLoansComponent } from './admin-loans.component';
import { environment } from '../../../../environments/environment';
import { Loan, LoanStatus } from '../../../core/models/loan.model';
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

function makeLoan(overrides: Partial<Loan> = {}): Loan {
  return {
    id: 'loan1',
    userId: 'u1',
    amount: 100000,
    interestRate: 5,
    durationMonths: 6,
    monthlyPayment: 17500,
    remainingBalance: 100000,
    status: LoanStatus.EN_ATTENTE,
    purpose: 'Achat matériel informatique',
    requestDate: '2026-08-05T08:30:00.000Z',
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
    onTimeRepayments: 1,
    lateRepayments: 0,
    calculatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

interface SetupResult {
  component: AdminLoansComponent;
  httpMock: HttpTestingController;
}

function setup(): SetupResult {
  TestBed.configureTestingModule({
    imports: [AdminLoansComponent],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: AuthService, useValue: { currentUser: signal(makeUser({ role: UserRole.ADMIN })) } },
    ],
  });

  const httpMock = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(AdminLoansComponent);
  const component = fixture.componentInstance;
  fixture.detectChanges();

  return { component, httpMock };
}

/** Flushe les 3 requêtes de `DashboardService.getAdminLoansManagement()` (loans, users, credit-scores). */
function flushLoad(httpMock: HttpTestingController, loans: Loan[], users: User[], creditScores: CreditScore[]): void {
  httpMock.expectOne(`${API}/loans`).flush(loans);
  httpMock.expectOne(`${API}/users`).flush(users);
  httpMock.expectOne(`${API}/credit-scores`).flush(creditScores);
}

describe('AdminLoansComponent', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('affiche toutes les demandes de prêt avec leurs informations', () => {
    const { component, httpMock } = setup();
    const loan = makeLoan({ amount: 250000, purpose: 'Extension boutique' });

    flushLoad(httpMock, [loan], [makeUser()], []);

    expect(component.filteredLoans()).toHaveLength(1);
    expect(component.filteredLoans()[0].amount).toBe(250000);
    expect(component.hasLoans()).toBe(true);
  });

  it('résout correctement le nom, le numéro de compte et le score du client demandeur', () => {
    const { component, httpMock } = setup();
    const user = makeUser({ id: 'u1', firstName: 'Fatou', lastName: 'Ndiaye', accountNumber: 'ACC-0002' });
    const score = makeCreditScore({ userId: 'u1', score: 82, category: CreditScoreCategory.EXCELLENT });

    flushLoad(httpMock, [makeLoan({ userId: 'u1' })], [user], [score]);

    expect(component.userLabel('u1')).toBe('Fatou Ndiaye');
    expect(component.userAccountNumber('u1')).toBe('ACC-0002');
    expect(component.creditScoreFor('u1')?.score).toBe(82);
  });

  it('filtre les prêts par nom, email ou numéro de compte du client (recherche)', () => {
    const { component, httpMock } = setup();
    const users = [
      makeUser({ id: 'u1', firstName: 'Fatou', lastName: 'Ndiaye', email: 'fatou.ndiaye@example.sn', accountNumber: 'ACC-0001' }),
      makeUser({ id: 'u2', firstName: 'Moussa', lastName: 'Diop', email: 'moussa.diop@example.sn', accountNumber: 'ACC-0002' }),
    ];
    const loans = [makeLoan({ id: 'loan1', userId: 'u1' }), makeLoan({ id: 'loan2', userId: 'u2' })];

    flushLoad(httpMock, loans, users, []);

    component.searchTerm.set('moussa');
    expect(component.filteredLoans().map((l) => l.id)).toEqual(['loan2']);

    component.searchTerm.set('ACC-0001');
    expect(component.filteredLoans().map((l) => l.id)).toEqual(['loan1']);
  });

  it('filtre les prêts par statut et par catégorie de score, et permet de réinitialiser', () => {
    const { component, httpMock } = setup();
    const users = [makeUser({ id: 'u1' }), makeUser({ id: 'u2', accountNumber: 'ACC-0002' })];
    const loans = [
      makeLoan({ id: 'loan1', userId: 'u1', status: LoanStatus.EN_ATTENTE }),
      makeLoan({ id: 'loan2', userId: 'u2', status: LoanStatus.EN_COURS }),
    ];
    const scores = [
      makeCreditScore({ userId: 'u1', category: CreditScoreCategory.EXCELLENT }),
      makeCreditScore({ userId: 'u2', category: CreditScoreCategory.MAUVAIS_PAYEUR }),
    ];

    flushLoad(httpMock, loans, users, scores);

    component.statusFilter.set(LoanStatus.EN_COURS);
    expect(component.filteredLoans().map((l) => l.id)).toEqual(['loan2']);

    component.statusFilter.set('ALL');
    component.categoryFilter.set(CreditScoreCategory.EXCELLENT);
    expect(component.filteredLoans().map((l) => l.id)).toEqual(['loan1']);

    expect(component.hasActiveFilters()).toBe(true);
    component.resetFilters();
    expect(component.hasActiveFilters()).toBe(false);
    expect(component.filteredLoans()).toHaveLength(2);
  });

  it('valide une demande EN_ATTENTE après confirmation en un seul appel atomique', () => {
    const { component, httpMock } = setup();
    const loan = makeLoan({ id: 'loan1', status: LoanStatus.EN_ATTENTE });

    flushLoad(httpMock, [loan], [makeUser()], []);

    component.requestApprove(loan);
    expect(component.pendingAction()).toEqual({ loanId: 'loan1', action: 'approve' });

    component.confirmAction();
    expect(component.actionSubmitting()).toBe(true);

    const req = httpMock.expectOne(`${API}/loans/loan1/approve`);
    expect(req.request.method).toBe('POST');
    req.flush({ ...loan, status: LoanStatus.EN_COURS, startDate: '2026-08-17T10:00:00.000Z' });

    expect(component.actionSubmitting()).toBe(false);
    expect(component.pendingAction()).toBeNull();
    expect(component.filteredLoans()[0].status).toBe(LoanStatus.EN_COURS);
    expect(component.actionSuccess()).toContain('approuvé');
  });

  it('rejette une demande EN_ATTENTE après confirmation', () => {
    const { component, httpMock } = setup();
    const loan = makeLoan({ id: 'loan1', status: LoanStatus.EN_ATTENTE });

    flushLoad(httpMock, [loan], [makeUser()], []);

    component.requestReject(loan);
    component.confirmAction();

    const req = httpMock.expectOne(`${API}/loans/loan1/reject`);
    expect(req.request.method).toBe('POST');
    req.flush({ ...loan, status: LoanStatus.REJETE });

    expect(component.filteredLoans()[0].status).toBe(LoanStatus.REJETE);
    expect(component.actionSuccess()).toBe('Demande rejetée.');
  });

  it("affiche le message d'erreur renvoyé par le serveur quand la validation échoue (ex: demande déjà traitée)", () => {
    const { component, httpMock } = setup();
    const loan = makeLoan({ id: 'loan1', status: LoanStatus.EN_ATTENTE });

    flushLoad(httpMock, [loan], [makeUser()], []);

    component.requestApprove(loan);
    component.confirmAction();

    httpMock
      .expectOne(`${API}/loans/loan1/approve`)
      .flush({ message: 'Cette demande a déjà été traitée.' }, { status: 409, statusText: 'Conflict' });

    expect(component.actionError()).toBe('Cette demande a déjà été traitée.');
    expect(component.actionSubmitting()).toBe(false);
    expect(component.pendingAction()).toBeNull();
  });

  it("annule une action en attente sans appeler l'API", () => {
    const { component, httpMock } = setup();
    const loan = makeLoan({ id: 'loan1', status: LoanStatus.EN_ATTENTE });

    flushLoad(httpMock, [loan], [makeUser()], []);

    component.requestApprove(loan);
    component.cancelAction();

    expect(component.pendingAction()).toBeNull();
    httpMock.expectNone(`${API}/loans/loan1/approve`);
  });

  it("n'affiche pas les actions de validation/rejet pour un prêt déjà traité", () => {
    const { component, httpMock } = setup();
    const loan = makeLoan({ id: 'loan1', status: LoanStatus.EN_COURS });

    flushLoad(httpMock, [loan], [makeUser()], []);

    expect(component.isPending(loan)).toBe(false);
    component.requestApprove(loan);
    expect(component.pendingAction()).toBeNull();
  });

  it('affiche une erreur quand le chargement initial échoue, avec possibilité de réessayer', () => {
    const { component, httpMock } = setup();

    httpMock.expectOne(`${API}/loans`).flush('Erreur', { status: 500, statusText: 'Server Error' });
    httpMock.match(`${API}/users`).filter((r) => !r.cancelled).forEach((r) => r.flush([]));
    httpMock.match(`${API}/credit-scores`).filter((r) => !r.cancelled).forEach((r) => r.flush([]));

    expect(component.error()).toBe('Impossible de charger la liste des prêts.');
    expect(component.loading()).toBe(false);

    component.retry();
    flushLoad(httpMock, [makeLoan()], [makeUser()], []);

    expect(component.error()).toBeNull();
    expect(component.filteredLoans()).toHaveLength(1);
  });

  it('affiche un indicateur de chargement pendant la requête initiale', () => {
    const { component, httpMock } = setup();

    expect(component.loading()).toBe(true);
    flushLoad(httpMock, [], [], []);
    expect(component.loading()).toBe(false);
  });
});

/** La route /admin/loans hérite de la protection `roleGuard(UserRole.ADMIN)` posée sur `/admin` (canActivateChild). */
describe('AdminLoansComponent - accès réservé à ADMIN (roleGuard sur /admin/loans)', () => {
  function runGuard(currentUser: User | null): boolean | UrlTree {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: AuthService, useValue: { currentUser: signal(currentUser) } }],
    });

    let result!: boolean | UrlTree;
    TestBed.runInInjectionContext(() => {
      result = roleGuard(UserRole.ADMIN)({} as never, { url: '/admin/loans' } as never) as boolean | UrlTree;
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
    expect(runGuard(makeUser({ role: UserRole.ADMIN }))).toBe(true);
  });
});
