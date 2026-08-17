import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, UrlTree, provideRouter } from '@angular/router';
import { signal } from '@angular/core';

import { AdminLoansComponent } from './admin-loans.component';
import { environment } from '../../../../environments/environment';
import { Loan, LoanStatus } from '../../../core/models/loan.model';
import { User, UserRole, UserStatus } from '../../../core/models/user.model';
import { Repayment, RepaymentStatus } from '../../../core/models/repayment.model';
import { CreditScoreCategory } from '../../../core/models/credit-score.model';
import { TransactionStatus, TransactionType } from '../../../core/models/transaction.model';
import { roleGuard } from '../../../core/guards/role.guard';
import { AuthService } from '../../../core/services/auth.service';
import { computeCreditScore } from '../../../core/utils/credit-score.util';
import { scheduleTotalDue } from '../../../core/utils/loan-schedule.util';

const API = environment.apiUrl;

/**
 * Cette application est zoneless (pas de `zone.js`), donc `fakeAsync`/`tick`
 * ne sont pas disponibles pour avancer virtuellement le délai du retry
 * automatique : on attend réellement (délais courts, voir
 * `ACTIVATION_RETRY_BASE_DELAY_MS` / `RepaymentService.RETRY_BASE_DELAY_MS`).
 */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

function makeAdmin(overrides: Partial<User> = {}): User {
  return makeUser({
    id: 'admin1',
    firstName: 'Admin',
    lastName: 'Système',
    email: 'admin@dakartech.sn',
    accountNumber: 'ACC-0000',
    role: UserRole.ADMIN,
    ...overrides,
  });
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

function makeRepayment(overrides: Partial<Repayment> = {}): Repayment {
  return {
    id: 'rp1',
    loanId: 'loan1',
    userId: 'u1',
    installmentNumber: 1,
    dueDate: '2026-06-01T00:00:00.000Z',
    amountDue: 10000,
    status: RepaymentStatus.PAYE,
    amountPaid: 10000,
    paymentDate: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

interface SetupResult {
  component: AdminLoansComponent;
  httpMock: HttpTestingController;
  fixture: ReturnType<typeof TestBed.createComponent<AdminLoansComponent>>;
}

function setup(currentUser: User | null = makeAdmin()): SetupResult {
  TestBed.configureTestingModule({
    imports: [AdminLoansComponent],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: AuthService,
        useValue: {
          currentUser: signal(currentUser),
          getCurrentUser: () => currentUser,
        },
      },
    ],
  });

  const httpMock = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(AdminLoansComponent);
  const component = fixture.componentInstance;
  fixture.detectChanges();

  return { component, httpMock, fixture };
}

/**
 * Flushe la requête active la plus récente pour chaque appel de
 * `getAdminLoansManagement()` (loans, users, repayments). Utilise
 * `match()` plutôt que `expectOne()` pour rester robuste après un
 * rafraîchissement déclenché par une action (validation/rejet).
 *
 * Le score de solvabilité n'est plus lu depuis `/creditScores` mais
 * recalculé en direct à partir de `/repayments` (voir
 * `DashboardService.getAdminLoansManagement`).
 */
function flushLoad(httpMock: HttpTestingController, loans: Loan[], users: User[], repayments: Repayment[]): void {
  const loanReqs = httpMock.match(`${API}/loans`).filter((req) => !req.cancelled);
  expect(loanReqs.length).toBe(1);
  loanReqs[0].flush(loans);

  const usersReqs = httpMock.match(`${API}/users`).filter((req) => !req.cancelled);
  expect(usersReqs.length).toBe(1);
  usersReqs[0].flush(users);

  const repaymentReqs = httpMock.match(`${API}/repayments`).filter((req) => !req.cancelled);
  expect(repaymentReqs.length).toBe(1);
  repaymentReqs[0].flush(repayments);
}

/**
 * Flushe la suite de la validation d'un prêt une fois le décaissement
 * effectué : la génération de l'échéancier (relecture des échéances déjà
 * persistées puis création une par une de celles qui manquent, voir
 * `RepaymentService.createSchedule`) et, en parallèle, le passage du prêt
 * d'APPROUVE à EN_COURS (voir `activateLoan`). `existingRepayments` permet
 * de simuler un échéancier déjà partiellement généré (reprise après échec).
 */
function flushActivation(httpMock: HttpTestingController, loan: Loan, existingRepayments: Repayment[] = []): void {
  // La relecture des échéances existantes et le PATCH du prêt sont
  // déclenchés en parallèle (forkJoin) dès la souscription.
  const getReq = httpMock.expectOne(
    (r) => r.method === 'GET' && r.url === `${API}/repayments` && r.params.get('loanId') === loan.id,
  );

  const activateReq = httpMock.expectOne(`${API}/loans/${loan.id}`);
  expect(activateReq.request.method).toBe('PATCH');
  expect(activateReq.request.body.status).toBe(LoanStatus.EN_COURS);
  expect(activateReq.request.body.remainingBalance).toBe(scheduleTotalDue(loan));
  activateReq.flush({ ...loan, ...activateReq.request.body });

  getReq.flush(existingRepayments);

  const existingNumbers = new Set(existingRepayments.map((r) => r.installmentNumber));
  for (let i = 1; i <= loan.durationMonths; i++) {
    if (existingNumbers.has(i)) continue;
    const req = httpMock.expectOne((r) => r.method === 'POST' && r.url === `${API}/repayments`);
    expect(req.request.body.installmentNumber).toBe(i);
    req.flush({ id: `rp-new-${i}`, ...req.request.body });
  }
}

describe('AdminLoansComponent', () => {
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  it('1. affiche toutes les demandes de prêt avec leurs informations', () => {
    const users = [makeUser({ id: 'u1' })];
    const loans = [
      makeLoan({
        id: 'loan1',
        userId: 'u1',
        amount: 100000,
        purpose: 'Achat matériel informatique',
        durationMonths: 6,
        interestRate: 5,
        remainingBalance: 100000,
        status: LoanStatus.EN_ATTENTE,
      }),
    ];
    const { component, fixture, httpMock } = setup();

    flushLoad(httpMock, loans, users, []);
    fixture.detectChanges();

    expect(component.filteredLoans().length).toBe(1);
    expect(component.hasLoans()).toBe(true);

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Fatou Ndiaye');
    expect(text).toContain('ACC-0001');
    expect(text).toContain('Achat matériel informatique');
    expect(text).toContain('6 mois');
    expect(text).toContain('5 %');
    expect(text).toContain('En attente');
  });

  it('2. résout correctement le nom et le numéro de compte du client demandeur', () => {
    const users = [makeUser({ id: 'u1', firstName: 'Moussa', lastName: 'Diop', accountNumber: 'ACC-0003' })];
    const loans = [makeLoan({ id: 'loan1', userId: 'u1' })];
    const { component, httpMock } = setup();

    flushLoad(httpMock, loans, users, []);

    expect(component.userLabel('u1')).toBe('Moussa Diop');
    expect(component.userAccountNumber('u1')).toBe('ACC-0003');
    expect(component.userLabel('inexistant')).toBe('—');
  });

  it('3. affiche le score de solvabilité du demandeur, recalculé à partir de ses remboursements réels', () => {
    const users = [makeUser({ id: 'u1' })];
    const loans = [makeLoan({ id: 'loan1', userId: 'u1' })];
    // Historique entièrement à temps : score au-dessus du seuil EXCELLENT (80).
    const repayments = Array.from({ length: 6 }, (_, i) =>
      makeRepayment({
        id: `rp${i}`,
        userId: 'u1',
        installmentNumber: i + 1,
        dueDate: `2026-0${(i % 6) + 1}-01T00:00:00.000Z`,
        paymentDate: `2026-0${(i % 6) + 1}-01T00:00:00.000Z`,
      }),
    );
    const expected = computeCreditScore(repayments);
    const { component, fixture, httpMock } = setup();

    flushLoad(httpMock, loans, users, repayments);
    fixture.detectChanges();

    expect(component.creditScoreFor('u1')?.score).toBe(expected.score);
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain(String(expected.score));
    expect(text).toContain('Excellent');
  });

  it("affiche un score de base (pas de tiret) quand le client n'a pas encore d'historique de remboursement", () => {
    const users = [makeUser({ id: 'u1' })];
    const loans = [makeLoan({ id: 'loan1', userId: 'u1' })];
    const expected = computeCreditScore([]);
    const { component, httpMock } = setup();

    flushLoad(httpMock, loans, users, []);

    // Le score n'est plus jamais absent : sans historique, il est recalculé
    // à partir d'une liste vide plutôt que de dépendre d'un ancien
    // enregistrement `/creditScores` potentiellement inexistant.
    expect(component.creditScoreFor('u1')?.score).toBe(expected.score);
  });

  it('4. filtre les prêts par nom, email ou numéro de compte du client (recherche)', () => {
    const users = [
      makeUser({ id: 'u1', firstName: 'Fatou', lastName: 'Ndiaye', email: 'fatou.ndiaye@example.sn', accountNumber: 'ACC-0001' }),
      makeUser({ id: 'u2', firstName: 'Moussa', lastName: 'Diop', email: 'moussa.diop@example.sn', accountNumber: 'ACC-0002' }),
    ];
    const loans = [
      makeLoan({ id: 'loan1', userId: 'u1' }),
      makeLoan({ id: 'loan2', userId: 'u2' }),
    ];
    const { component, httpMock } = setup();

    flushLoad(httpMock, loans, users, []);

    component.searchTerm.set('moussa');
    expect(component.filteredLoans().map((l) => l.id)).toEqual(['loan2']);

    component.searchTerm.set('fatou.ndiaye@example.sn');
    expect(component.filteredLoans().map((l) => l.id)).toEqual(['loan1']);

    component.searchTerm.set('ACC-0002');
    expect(component.filteredLoans().map((l) => l.id)).toEqual(['loan2']);

    component.searchTerm.set('inexistant');
    expect(component.filteredLoans().length).toBe(0);
  });

  it('5. filtre les prêts par statut et par catégorie de score, et permet de réinitialiser', () => {
    const users = [makeUser({ id: 'u1' }), makeUser({ id: 'u2', accountNumber: 'ACC-0002' })];
    const loans = [
      makeLoan({ id: 'loan1', userId: 'u1', status: LoanStatus.EN_ATTENTE }),
      makeLoan({ id: 'loan2', userId: 'u2', status: LoanStatus.APPROUVE }),
    ];
    // u1 sans historique : score de base (60, BON). u2 avec une échéance en
    // retard de 10 jours : pénalité de 15, score 45 (A_RISQUE, seuil 35-59).
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const repayments = [
      makeRepayment({
        id: 'rp-u2',
        userId: 'u2',
        status: RepaymentStatus.EN_RETARD,
        dueDate: tenDaysAgo,
        amountPaid: undefined,
        paymentDate: undefined,
      }),
    ];
    const u1Score = computeCreditScore([]);
    const u2Score = computeCreditScore(repayments);
    expect(u1Score.category).toBe(CreditScoreCategory.BON);
    expect(u2Score.category).toBe(CreditScoreCategory.A_RISQUE);
    const { component, httpMock } = setup();

    flushLoad(httpMock, loans, users, repayments);

    component.statusFilter.set(LoanStatus.APPROUVE);
    expect(component.filteredLoans().map((l) => l.id)).toEqual(['loan2']);
    component.statusFilter.set('ALL');

    component.categoryFilter.set(CreditScoreCategory.A_RISQUE);
    expect(component.filteredLoans().map((l) => l.id)).toEqual(['loan2']);

    expect(component.hasActiveFilters()).toBe(true);
    component.resetFilters();
    expect(component.hasActiveFilters()).toBe(false);
    expect(component.filteredLoans().length).toBe(2);
  });

  it("6. valide une demande EN_ATTENTE après confirmation : statut APPROUVE, approvedBy et date renseignés", () => {
    const admin = makeAdmin({ id: 'admin1' });
    const client = makeUser({ id: 'u1', walletBalance: 65000 });
    const loan = makeLoan({ id: 'loan1', userId: 'u1', amount: 100000, status: LoanStatus.EN_ATTENTE });
    const { component, httpMock } = setup(admin);

    flushLoad(httpMock, [loan], [client], []);

    component.requestApprove(loan);
    expect(component.pendingAction()).toEqual({ loanId: 'loan1', action: 'approve' });

    component.confirmAction();
    expect(component.actionSubmitting()).toBe(true);

    httpMock.expectOne(`${API}/loans/loan1`).flush(loan);
    httpMock.expectOne(`${API}/users/u1`).flush(client);

    const patchLoanReq = httpMock.expectOne(`${API}/loans/loan1`);
    expect(patchLoanReq.request.method).toBe('PATCH');
    expect(patchLoanReq.request.body.status).toBe(LoanStatus.APPROUVE);
    expect(patchLoanReq.request.body.approvedBy).toBe('admin1');
    expect(patchLoanReq.request.body.approvalDate).toBeTruthy();
    const approvedLoan = { ...loan, ...patchLoanReq.request.body };
    patchLoanReq.flush(approvedLoan);

    // La transaction de décaissement est créée avant le crédit du
    // portefeuille (et non en parallèle), afin de toujours savoir laquelle
    // des deux écritures a réellement abouti en cas d'échec de l'autre.
    const txReq = httpMock.expectOne(`${API}/transactions`);
    txReq.flush({ id: 'tx-new', ...txReq.request.body });

    const patchUserReq = httpMock.expectOne(`${API}/users/u1`);
    expect(patchUserReq.request.method).toBe('PATCH');
    patchUserReq.flush({ ...client, walletBalance: 165000 });

    // Une fois décaissé, l'échéancier est généré et le prêt passe d'APPROUVE à EN_COURS.
    flushActivation(httpMock, approvedLoan);

    expect(component.actionSubmitting()).toBe(false);
    expect(component.pendingAction()).toBeNull();
    expect(component.actionSuccess()).toContain('approuvé');
    // La table reflète immédiatement le nouveau statut, sans dépendre d'un
    // rechargement complet (voir patchLoanInData/patchUserInData).
    expect(component.filteredLoans()[0].status).toBe(LoanStatus.EN_COURS);
    expect(component.filteredLoans()[0].approvedBy).toBe('admin1');
    expect(component.filteredLoans()[0].startDate).toBeTruthy();
  });

  it('bloque l’approbation et le décaissement si le client est SUSPENDED (revérification serveur)', () => {
    const admin = makeAdmin({ id: 'admin1' });
    const client = makeUser({ id: 'u1', status: UserStatus.SUSPENDED });
    const loan = makeLoan({ id: 'loan1', userId: 'u1', status: LoanStatus.EN_ATTENTE });
    const { component, httpMock } = setup(admin);

    flushLoad(httpMock, [loan], [client], []);
    component.requestApprove(loan);
    component.confirmAction();

    httpMock.expectOne(`${API}/loans/loan1`).flush(loan);
    httpMock.expectOne(`${API}/users/u1`).flush(client);

    expect(component.actionError()).toContain('suspendu');
    expect(component.actionSubmitting()).toBe(false);
    expect(component.pendingAction()).toBeNull();
    expect(component.filteredLoans()[0].status).toBe(LoanStatus.EN_ATTENTE);

    httpMock.expectNone((req) => req.url === `${API}/loans/loan1` && req.method === 'PATCH');
    httpMock.expectNone(`${API}/transactions`);
    httpMock.expectNone(`${API}/repayments`);
  });

  it("7. rejette une demande EN_ATTENTE après confirmation : statut REJETE et approvedBy renseigné", () => {
    const admin = makeAdmin({ id: 'admin1' });
    const client = makeUser({ id: 'u1' });
    const loan = makeLoan({ id: 'loan1', userId: 'u1', status: LoanStatus.EN_ATTENTE });
    const { component, httpMock } = setup(admin);

    flushLoad(httpMock, [loan], [client], []);

    component.requestReject(loan);
    expect(component.pendingAction()).toEqual({ loanId: 'loan1', action: 'reject' });

    component.confirmAction();

    httpMock.expectOne(`${API}/loans/loan1`).flush(loan);

    const patchLoanReq = httpMock.expectOne(`${API}/loans/loan1`);
    expect(patchLoanReq.request.method).toBe('PATCH');
    expect(patchLoanReq.request.body).toEqual({ status: LoanStatus.REJETE, approvedBy: 'admin1' });
    patchLoanReq.flush({ ...loan, ...patchLoanReq.request.body });

    expect(component.actionSubmitting()).toBe(false);
    expect(component.pendingAction()).toBeNull();
    expect(component.actionSuccess()).toContain('rejetée');
    expect(component.filteredLoans()[0].status).toBe(LoanStatus.REJETE);
    expect(component.filteredLoans()[0].approvedBy).toBe('admin1');

    httpMock.expectNone(`${API}/transactions`);
  });

  it('8. crédite automatiquement le portefeuille du client du montant du prêt lors de la validation', () => {
    const admin = makeAdmin({ id: 'admin1' });
    const client = makeUser({ id: 'u1', walletBalance: 65000 });
    const loan = makeLoan({ id: 'loan1', userId: 'u1', amount: 100000, status: LoanStatus.EN_ATTENTE });
    const { component, httpMock } = setup(admin);

    flushLoad(httpMock, [loan], [client], []);
    component.requestApprove(loan);
    component.confirmAction();

    httpMock.expectOne(`${API}/loans/loan1`).flush(loan);
    httpMock.expectOne(`${API}/users/u1`).flush(client);
    const approvedLoan = { ...loan, status: LoanStatus.APPROUVE };
    httpMock.expectOne(`${API}/loans/loan1`).flush(approvedLoan);

    httpMock.expectOne(`${API}/transactions`).flush({ id: 'tx-new' });

    const patchUserReq = httpMock.expectOne(`${API}/users/u1`);
    expect(patchUserReq.request.body).toEqual({ walletBalance: 165000 });
    patchUserReq.flush({ ...client, walletBalance: 165000 });

    flushActivation(httpMock, approvedLoan);

    expect(component.userFor('u1')?.walletBalance).toBe(165000);
  });

  it('9. crée la transaction DECAISSEMENT_PRET avec le statut REUSSIE lors de la validation', () => {
    const admin = makeAdmin({ id: 'admin1' });
    const client = makeUser({ id: 'u1', walletBalance: 65000 });
    const loan = makeLoan({ id: 'loan1', userId: 'u1', amount: 100000, status: LoanStatus.EN_ATTENTE });
    const { component, httpMock } = setup(admin);

    flushLoad(httpMock, [loan], [client], []);
    component.requestApprove(loan);
    component.confirmAction();

    httpMock.expectOne(`${API}/loans/loan1`).flush(loan);
    httpMock.expectOne(`${API}/users/u1`).flush(client);
    const approvedLoan = { ...loan, status: LoanStatus.APPROUVE };
    httpMock.expectOne(`${API}/loans/loan1`).flush(approvedLoan);

    const txReq = httpMock.expectOne(`${API}/transactions`);
    expect(txReq.request.method).toBe('POST');
    expect(txReq.request.body.type).toBe(TransactionType.DECAISSEMENT_PRET);
    expect(txReq.request.body.status).toBe(TransactionStatus.REUSSIE);
    expect(txReq.request.body.amount).toBe(100000);
    expect(txReq.request.body.receiverId).toBe('u1');
    expect(txReq.request.body.relatedLoanId).toBe('loan1');
    txReq.flush({ id: 'tx-new', ...txReq.request.body });

    httpMock.expectOne(`${API}/users/u1`).flush({ ...client, walletBalance: 165000 });

    flushActivation(httpMock, approvedLoan);
  });

  it("10. empêche une double soumission lors de la validation d'un prêt", () => {
    const admin = makeAdmin({ id: 'admin1' });
    const client = makeUser({ id: 'u1' });
    const loan = makeLoan({ id: 'loan1', userId: 'u1', status: LoanStatus.EN_ATTENTE });
    const { component, httpMock } = setup(admin);

    flushLoad(httpMock, [loan], [client], []);
    component.requestApprove(loan);
    component.confirmAction();
    component.confirmAction();

    const freshLoanReqs = httpMock.match(`${API}/loans/loan1`);
    expect(freshLoanReqs.length).toBe(1);
    freshLoanReqs[0].flush(loan);

    httpMock.expectOne(`${API}/users/u1`).flush(client);
    const approvedLoan = { ...loan, status: LoanStatus.APPROUVE };
    httpMock.expectOne(`${API}/loans/loan1`).flush(approvedLoan);
    httpMock.expectOne(`${API}/transactions`).flush({ id: 'tx-new' });
    httpMock.expectOne(`${API}/users/u1`).flush(client);
    flushActivation(httpMock, approvedLoan);
  });

  it("empêche de traiter à nouveau une demande déjà traitée entre-temps (double clic sur deux onglets)", () => {
    const admin = makeAdmin({ id: 'admin1' });
    const client = makeUser({ id: 'u1' });
    const loan = makeLoan({ id: 'loan1', userId: 'u1', status: LoanStatus.EN_ATTENTE });
    const { component, httpMock } = setup(admin);

    flushLoad(httpMock, [loan], [client], []);
    component.requestApprove(loan);
    component.confirmAction();

    httpMock.expectOne(`${API}/loans/loan1`).flush({ ...loan, status: LoanStatus.REJETE });

    expect(component.actionError()).toBe('Cette demande a déjà été traitée.');
    expect(component.actionSubmitting()).toBe(false);
    expect(component.pendingAction()).toBeNull();
    expect(component.filteredLoans()[0].status).toBe(LoanStatus.REJETE);
    httpMock.expectNone(`${API}/users/u1`);
    httpMock.expectNone(`${API}/transactions`);
  });

  it('11. affiche une erreur quand le chargement initial échoue, avec possibilité de réessayer', () => {
    const { component, httpMock } = setup();

    httpMock.expectOne(`${API}/loans`).flush('Erreur serveur', { status: 500, statusText: 'Server Error' });

    expect(component.error()).toBe('Impossible de charger la liste des prêts.');
    expect(component.loading()).toBe(false);

    component.retry();
    expect(component.loading()).toBe(true);

    flushLoad(httpMock, [makeLoan()], [makeUser()], []);
    expect(component.error()).toBeNull();
    expect(component.filteredLoans().length).toBe(1);
  });

  it("affiche une erreur d'action quand la validation échoue côté serveur", () => {
    const admin = makeAdmin({ id: 'admin1' });
    const client = makeUser({ id: 'u1' });
    const loan = makeLoan({ id: 'loan1', userId: 'u1', status: LoanStatus.EN_ATTENTE });
    const { component, httpMock } = setup(admin);

    flushLoad(httpMock, [loan], [client], []);
    component.requestApprove(loan);
    component.confirmAction();

    httpMock.expectOne(`${API}/loans/loan1`).flush('Erreur', { status: 500, statusText: 'Server Error' });

    expect(component.actionError()).toBe('Impossible de vérifier l’état de la demande. Veuillez réessayer.');
    expect(component.actionSubmitting()).toBe(false);
  });

  it('12. affiche un indicateur de chargement pendant la requête initiale, puis succès ou erreur après une action', () => {
    const { component, httpMock } = setup();

    expect(component.loading()).toBe(true);

    flushLoad(httpMock, [], [], []);
    expect(component.loading()).toBe(false);
    expect(component.hasLoans()).toBe(false);
  });

  it("annule une action en attente sans appeler l'API", () => {
    const loan = makeLoan({ id: 'loan1', status: LoanStatus.EN_ATTENTE });
    const { component, httpMock } = setup();

    flushLoad(httpMock, [loan], [makeUser()], []);

    component.requestApprove(loan);
    component.cancelAction();

    expect(component.pendingAction()).toBeNull();
    httpMock.expectNone(`${API}/loans/loan1`);
  });

  it("n'affiche pas les actions de validation/rejet pour un prêt déjà traité", () => {
    const loan = makeLoan({ id: 'loan1', status: LoanStatus.APPROUVE });
    const { component, httpMock } = setup();

    flushLoad(httpMock, [loan], [makeUser()], []);

    expect(component.isPending(loan)).toBe(false);
    component.requestApprove(loan);
    expect(component.pendingAction()).toBeNull();
  });

  // --- Régression : le prêt restait bloqué à APPROUVE quand la génération
  // de l'échéancier échouait après un décaissement déjà effectué (le cas
  // réel observé face à json-server --watch, qui recharge brièvement son
  // routeur après chaque écriture et peut faire échouer la requête suivante
  // avec une erreur de connexion). Voir `activateLoan`, `createSchedule`
  // (idempotente) et `confirmResumeSchedule` (reprise manuelle).

  it('récupère automatiquement d’un échec transitoire de génération d’échéancier (retry), sans intervention manuelle', async () => {
    const admin = makeAdmin({ id: 'admin1' });
    const client = makeUser({ id: 'u1', walletBalance: 65000 });
    const loan = makeLoan({
      id: 'loan1',
      userId: 'u1',
      amount: 100000,
      durationMonths: 1,
      monthlyPayment: 105000,
      status: LoanStatus.EN_ATTENTE,
    });
    const { component, httpMock } = setup(admin);

    flushLoad(httpMock, [loan], [client], []);
    component.requestApprove(loan);
    component.confirmAction();

    httpMock.expectOne(`${API}/loans/loan1`).flush(loan);
    httpMock.expectOne(`${API}/users/u1`).flush(client);
    const approvedLoan = { ...loan, status: LoanStatus.APPROUVE, approvedBy: 'admin1', approvalDate: new Date().toISOString() };
    httpMock.expectOne(`${API}/loans/loan1`).flush(approvedLoan);
    httpMock.expectOne(`${API}/transactions`).flush({ id: 'tx-new' });
    httpMock.expectOne(`${API}/users/u1`).flush({ ...client, walletBalance: 165000 });

    // Le décaissement vient de réussir : l'activation démarre, avec en
    // parallèle le PATCH du prêt (qui réussit du premier coup)...
    const activateReq = httpMock.expectOne(`${API}/loans/loan1`);
    expect(activateReq.request.body.status).toBe(LoanStatus.EN_COURS);
    activateReq.flush({ ...approvedLoan, ...activateReq.request.body });

    // ...et la relecture de l'échéancier existant, qui tombe une première
    // fois dans la fenêtre de rechargement de json-server juste après les
    // écritures du décaissement.
    const getReq1 = httpMock.expectOne(
      (r) => r.method === 'GET' && r.url === `${API}/repayments` && r.params.get('loanId') === 'loan1',
    );
    getReq1.flush('connexion perdue', { status: 0, statusText: 'Unknown Error' });

    await wait(220); // délai avant le 1er retry automatique

    const getReq2 = httpMock.expectOne(
      (r) => r.method === 'GET' && r.url === `${API}/repayments` && r.params.get('loanId') === 'loan1',
    );
    getReq2.flush([]);

    const postReq = httpMock.expectOne((r) => r.method === 'POST' && r.url === `${API}/repayments`);
    postReq.flush({ id: 'rp-new-1', ...postReq.request.body });

    expect(component.actionSubmitting()).toBe(false);
    expect(component.actionSuccess()).toContain('échéancier généré');
    expect(component.filteredLoans()[0].status).toBe(LoanStatus.EN_COURS);
  });

  it('reproduit le bug signalé : si la génération de l’échéancier échoue malgré les tentatives automatiques, le prêt reste APPROUVE (déjà décaissé, jamais recrédité) et devient reprenable', async () => {
    const admin = makeAdmin({ id: 'admin1' });
    const client = makeUser({ id: 'u1', walletBalance: 65000 });
    const loan = makeLoan({
      id: 'loan1',
      userId: 'u1',
      amount: 100000,
      durationMonths: 1,
      monthlyPayment: 105000,
      status: LoanStatus.EN_ATTENTE,
    });
    const { component, httpMock } = setup(admin);

    flushLoad(httpMock, [loan], [client], []);
    component.requestApprove(loan);
    component.confirmAction();

    httpMock.expectOne(`${API}/loans/loan1`).flush(loan);
    httpMock.expectOne(`${API}/users/u1`).flush(client);
    const approvedLoan = { ...loan, status: LoanStatus.APPROUVE, approvedBy: 'admin1', approvalDate: new Date().toISOString() };
    httpMock.expectOne(`${API}/loans/loan1`).flush(approvedLoan);
    httpMock.expectOne(`${API}/transactions`).flush({ id: 'tx-new' });
    httpMock.expectOne(`${API}/users/u1`).flush({ ...client, walletBalance: 165000 });

    const activateReq = httpMock.expectOne(`${API}/loans/loan1`);
    activateReq.flush({ ...approvedLoan, ...activateReq.request.body });

    const failGet = () => {
      const req = httpMock.expectOne(
        (r) => r.method === 'GET' && r.url === `${API}/repayments` && r.params.get('loanId') === 'loan1',
      );
      req.flush('connexion perdue', { status: 0, statusText: 'Unknown Error' });
    };

    // 1 tentative initiale + 3 retries automatiques, tous en échec (fenêtre
    // de rechargement de json-server anormalement longue) : l'échec finit
    // par remonter au lieu de rester silencieusement bloqué.
    failGet();
    await wait(220);
    failGet();
    await wait(420);
    failGet();
    await wait(620);
    failGet();

    expect(component.actionSubmitting()).toBe(false);
    expect(component.pendingAction()).toBeNull();
    expect(component.actionError()).toContain('Générer l’échéancier');

    const stuckLoan = component.filteredLoans()[0];
    expect(stuckLoan.status).toBe(LoanStatus.APPROUVE);
    expect(component.canResumeSchedule(stuckLoan)).toBe(true);

    // Aucune requête supplémentaire de décaissement n'a été déclenchée par
    // l'échec de l'échéancier : ni nouveau crédit du portefeuille, ni
    // nouvelle transaction DECAISSEMENT_PRET.
    httpMock.expectNone((r) => r.method === 'PATCH' && r.url === `${API}/users/u1`);
    httpMock.expectNone((r) => r.method === 'POST' && r.url === `${API}/transactions`);
  });

  it('permet de reprendre uniquement la génération de l’échéancier d’un prêt déjà APPROUVE et décaissé, sans jamais recréditer le portefeuille ni recréer de décaissement', () => {
    const client = makeUser({ id: 'u1', walletBalance: 165000 });
    const loan = makeLoan({
      id: 'loan1',
      userId: 'u1',
      amount: 100000,
      durationMonths: 2,
      monthlyPayment: 21000,
      status: LoanStatus.APPROUVE,
      approvedBy: 'admin1',
      approvalDate: '2026-08-15T18:51:21.461Z',
    });
    const disbursementTx = {
      id: 'tx1',
      type: TransactionType.DECAISSEMENT_PRET,
      status: TransactionStatus.REUSSIE,
      amount: 100000,
      receiverId: 'u1',
      relatedLoanId: 'loan1',
      description: 'Décaissement prêt loan1',
      createdAt: '2026-08-15T18:51:21.493Z',
    };
    const { component, httpMock } = setup();

    flushLoad(httpMock, [loan], [client], []);

    expect(component.canResumeSchedule(loan)).toBe(true);
    component.requestResumeSchedule(loan);
    expect(component.pendingAction()).toEqual({ loanId: 'loan1', action: 'resume-schedule' });

    component.confirmAction();
    expect(component.actionSubmitting()).toBe(true);

    httpMock.expectOne(`${API}/loans/loan1`).flush(loan);

    const txReq = httpMock.expectOne(
      (r) => r.url === `${API}/transactions` && r.params.get('relatedLoanId') === 'loan1',
    );
    txReq.flush([disbursementTx]);

    flushActivation(httpMock, loan);

    expect(component.actionSubmitting()).toBe(false);
    expect(component.pendingAction()).toBeNull();
    expect(component.actionSuccess()).toContain('échéancier généré');
    expect(component.filteredLoans()[0].status).toBe(LoanStatus.EN_COURS);

    // Jamais de double décaissement : ni nouveau crédit du portefeuille, ni
    // nouvelle transaction DECAISSEMENT_PRET.
    httpMock.expectNone((r) => r.method === 'PATCH' && r.url === `${API}/users/u1`);
    httpMock.expectNone((r) => r.method === 'POST' && r.url === `${API}/transactions`);
  });

  it('refuse de reprendre l’échéancier si aucun décaissement confirmé n’existe pour ce prêt', () => {
    const client = makeUser({ id: 'u1' });
    const loan = makeLoan({ id: 'loan1', userId: 'u1', status: LoanStatus.APPROUVE });
    const { component, httpMock } = setup();

    flushLoad(httpMock, [loan], [client], []);
    component.requestResumeSchedule(loan);
    component.confirmAction();

    httpMock.expectOne(`${API}/loans/loan1`).flush(loan);
    httpMock
      .expectOne((r) => r.url === `${API}/transactions` && r.params.get('relatedLoanId') === 'loan1')
      .flush([]);

    expect(component.actionError()).toContain('Aucun décaissement');
    expect(component.actionSubmitting()).toBe(false);
    expect(component.pendingAction()).toBeNull();
    expect(component.filteredLoans()[0].status).toBe(LoanStatus.APPROUVE);

    httpMock.expectNone((r) => r.url === `${API}/repayments`);
    httpMock.expectNone((r) => r.url === `${API}/users/u1`);
  });

  it('reprend un échéancier déjà partiellement généré sans créer de doublons (idempotence)', () => {
    const client = makeUser({ id: 'u1' });
    const loan = makeLoan({
      id: 'loan1',
      userId: 'u1',
      durationMonths: 3,
      monthlyPayment: 21000,
      status: LoanStatus.APPROUVE,
      approvalDate: '2026-08-15T18:00:00.000Z',
    });
    const disbursementTx = {
      id: 'tx1',
      type: TransactionType.DECAISSEMENT_PRET,
      status: TransactionStatus.REUSSIE,
      amount: loan.amount,
      receiverId: 'u1',
      relatedLoanId: 'loan1',
      description: 'Décaissement prêt loan1',
      createdAt: '2026-08-15T18:00:01.000Z',
    };
    const existingRepayment = makeRepayment({
      id: 'rp-existing',
      loanId: 'loan1',
      userId: 'u1',
      installmentNumber: 1,
      status: RepaymentStatus.PLANIFIE,
      amountPaid: undefined,
      paymentDate: undefined,
    });
    const { component, httpMock } = setup();

    flushLoad(httpMock, [loan], [client], []);
    component.requestResumeSchedule(loan);
    component.confirmAction();

    httpMock.expectOne(`${API}/loans/loan1`).flush(loan);
    httpMock
      .expectOne((r) => r.url === `${API}/transactions` && r.params.get('relatedLoanId') === 'loan1')
      .flush([disbursementTx]);

    flushActivation(httpMock, loan, [existingRepayment]);

    expect(component.actionSubmitting()).toBe(false);
    expect(component.filteredLoans()[0].status).toBe(LoanStatus.EN_COURS);
    httpMock.expectNone(
      (r) => r.method === 'POST' && r.url === `${API}/repayments` && r.body?.installmentNumber === 1,
    );
  });

  it('affiche le bouton "Générer l\'échéancier" pour un prêt APPROUVE, absent pour les autres statuts', () => {
    const loans = [
      makeLoan({ id: 'loan1', userId: 'u1', status: LoanStatus.APPROUVE }),
      makeLoan({ id: 'loan2', userId: 'u1', status: LoanStatus.EN_COURS, requestDate: '2026-08-01T00:00:00.000Z' }),
    ];
    const { fixture, httpMock } = setup();

    flushLoad(httpMock, loans, [makeUser({ id: 'u1' })], []);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain("Générer l'échéancier");

    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll('button.action-approve'),
    ) as HTMLButtonElement[];
    const scheduleButtons = buttons.filter((b) => b.textContent?.includes("Générer l'échéancier"));
    expect(scheduleButtons.length).toBe(1);
  });
});

/** 13. La route /admin/loans hérite de la protection `roleGuard(UserRole.ADMIN)` posée sur /admin (canActivateChild). */
describe("AdminLoansComponent - accès réservé à ADMIN (roleGuard sur /admin/loans)", () => {
  function runGuard(currentUser: User | null): boolean | UrlTree {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { currentUser: signal(currentUser) } },
      ],
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
    const result = runGuard(makeAdmin());
    expect(result).toBe(true);
  });
});
