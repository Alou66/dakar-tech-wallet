import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';

import { ClientLoanDetailComponent } from './client-loan-detail.component';
import { AuthService } from '../../../../core/services/auth.service';
import { environment } from '../../../../../environments/environment';
import { Loan, LoanStatus } from '../../../../core/models/loan.model';
import { Repayment, RepaymentStatus } from '../../../../core/models/repayment.model';
import { User, UserRole, UserStatus } from '../../../../core/models/user.model';
import { TransactionStatus, TransactionType } from '../../../../core/models/transaction.model';
import { deriveLoanStatus } from '../../../../core/utils/loan-status.util';

const API = environment.apiUrl;
const USER_ID = 'u1';

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: USER_ID,
    firstName: 'Awa',
    lastName: 'Diop',
    email: 'awa@test.com',
    phone: '770000000',
    accountNumber: 'ACC-0001',
    role: UserRole.CLIENT,
    status: UserStatus.ACTIVE,
    walletBalance: 100000,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeLoan(overrides: Partial<Loan> = {}): Loan {
  return {
    id: 'loan1',
    userId: USER_ID,
    amount: 100000,
    interestRate: 5,
    durationMonths: 4,
    monthlyPayment: 26250,
    remainingBalance: 52500,
    status: LoanStatus.EN_COURS,
    requestDate: '2026-01-01T00:00:00.000Z',
    startDate: '2026-01-05T00:00:00.000Z',
    ...overrides,
  };
}

function makeRepayment(overrides: Partial<Repayment> = {}): Repayment {
  return {
    id: 'rp1',
    loanId: 'loan1',
    userId: USER_ID,
    installmentNumber: 3,
    dueDate: '2026-08-01T00:00:00.000Z',
    amountDue: 26250,
    status: RepaymentStatus.PLANIFIE,
    ...overrides,
  };
}

interface SetupResult {
  component: ClientLoanDetailComponent;
  httpMock: HttpTestingController;
  user: User;
}

function setup(loan: Loan, repayments: Repayment[], userOverrides: Partial<User> = {}): SetupResult {
  const user = makeUser(userOverrides);

  TestBed.configureTestingModule({
    imports: [ClientLoanDetailComponent],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: AuthService, useValue: { getCurrentUser: () => user, currentUser: () => user } },
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { paramMap: convertToParamMap({ id: loan.id }) } },
      },
    ],
  });

  const httpMock = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(ClientLoanDetailComponent);
  const component = fixture.componentInstance;
  fixture.detectChanges();

  httpMock.expectOne(`${API}/loans/${loan.id}`).flush(loan);
  httpMock
    .expectOne((req) => req.url === `${API}/repayments` && req.params.get('loanId') === loan.id)
    .flush(repayments);

  const now = Date.now();
  const overdue = repayments.filter(
    (r) => r.status === RepaymentStatus.PLANIFIE && new Date(r.dueDate).getTime() < now,
  );
  const overdueIds = new Set(overdue.map((r) => r.id));
  for (const repayment of overdue) {
    const req = httpMock.expectOne(`${API}/repayments/${repayment.id}`);
    expect(req.request.method).toBe('PATCH');
    req.flush({ ...repayment, status: RepaymentStatus.EN_RETARD });
  }

  // Une fois l'échéancier reclassé, le statut du prêt est aligné dessus
  // (voir `LoanService.syncStatusFromRepayments`) : on flushe le PATCH
  // correspondant s'il en résulte un changement de statut.
  const repaymentsAfterSync = repayments.map((r) =>
    overdueIds.has(r.id) ? { ...r, status: RepaymentStatus.EN_RETARD } : r,
  );
  const nextLoanStatus = deriveLoanStatus(loan, repaymentsAfterSync);
  if (nextLoanStatus !== loan.status) {
    const loanStatusReq = httpMock.expectOne(`${API}/loans/${loan.id}`);
    expect(loanStatusReq.request.method).toBe('PATCH');
    expect(loanStatusReq.request.body).toEqual({ status: nextLoanStatus });
    loanStatusReq.flush({ ...loan, status: nextLoanStatus });
  }

  httpMock.expectOne(`${API}/users/${USER_ID}`).flush(user);

  return { component, httpMock, user };
}

function flushRefresh(httpMock: HttpTestingController, loan: Loan, repayments: Repayment[]): void {
  httpMock.expectOne(`${API}/loans/${loan.id}`).flush(loan);
  httpMock
    .expectOne((req) => req.url === `${API}/repayments` && req.params.get('loanId') === loan.id)
    .flush(repayments);
}

/** Flushes the defensive re-fetch (loan + installment + wallet balance) done right before a monthly payment is charged. */
function flushFreshLoanAndInstallment(
  httpMock: HttpTestingController,
  loan: Loan,
  repayment: Repayment,
  user: User,
): void {
  httpMock.expectOne(`${API}/loans/${loan.id}`).flush(loan);
  httpMock.expectOne(`${API}/repayments/${repayment.id}`).flush(repayment);
  httpMock.expectOne(`${API}/users/${USER_ID}`).flush(user);
}

/**
 * Flushes the async validator attached to `repaymentForm.repaymentId` (fires
 * automatically as soon as an installment is selected via `patchValue`) :
 * relit le prêt, l'échéance choisie et le client côté serveur pour vérifier
 * que la sélection est toujours payable avant d'autoriser la soumission.
 */
function flushRepaymentCheck(httpMock: HttpTestingController, loan: Loan, repayment: Repayment, user: User): void {
  httpMock.expectOne(`${API}/loans/${loan.id}`).flush(loan);
  httpMock.expectOne(`${API}/repayments/${repayment.id}`).flush(repayment);
  httpMock.expectOne(`${API}/users/${USER_ID}`).flush(user);
}

/** Flushes the defensive re-fetch (loan + full schedule + wallet balance) done right before a full settlement is charged. */
function flushFreshLoan(httpMock: HttpTestingController, loan: Loan, repayments: Repayment[], user: User): void {
  httpMock.expectOne(`${API}/loans/${loan.id}`).flush(loan);
  httpMock
    .expectOne((req) => req.url === `${API}/repayments` && req.params.get('loanId') === loan.id)
    .flush(repayments);
  httpMock.expectOne(`${API}/users/${USER_ID}`).flush(user);
}

describe('ClientLoanDetailComponent - Remboursements', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('1. rembourse une mensualité avec succès', () => {
    const loan = makeLoan();
    const repayment = makeRepayment();
    const { component, httpMock, user } = setup(loan, [repayment]);

    component.repaymentForm.patchValue({ repaymentId: repayment.id });
    flushRepaymentCheck(httpMock, loan, repayment, user);
    component.payInstallment();

    // Le clic sur "Payer cette mensualité" n'ouvre que la modale de
    // confirmation : aucune requête n'est envoyée avant validation explicite.
    expect(component.pendingAction()).toBe('installment');
    httpMock.expectNone(`${API}/transactions`);

    component.onConfirmModalConfirm();
    expect(component.repaymentSubmitting()).toBe(true);

    flushFreshLoanAndInstallment(httpMock, loan, repayment, user);

    const txReq = httpMock.expectOne(`${API}/transactions`);
    expect(txReq.request.method).toBe('POST');
    txReq.flush({ id: 'tx1', ...txReq.request.body });

    const userReq = httpMock.expectOne(`${API}/users/${USER_ID}`);
    expect(userReq.request.method).toBe('PATCH');
    userReq.flush({ ...makeUser(), walletBalance: 73750 });

    const repReq = httpMock.expectOne(`${API}/repayments/${repayment.id}`);
    expect(repReq.request.method).toBe('PATCH');
    repReq.flush({ ...repayment, status: RepaymentStatus.PAYE, amountPaid: 26250 });

    const loanReq = httpMock.expectOne(`${API}/loans/${loan.id}`);
    expect(loanReq.request.method).toBe('PATCH');
    expect(loanReq.request.body).toEqual({ remainingBalance: 26250 });
    loanReq.flush({ ...loan, remainingBalance: 26250 });

    flushRefresh(httpMock, { ...loan, remainingBalance: 26250 }, [
      { ...repayment, status: RepaymentStatus.PAYE, amountPaid: 26250 },
    ]);

    expect(component.repaymentSubmitting()).toBe(false);
    expect(component.repaymentSuccessMessage()).toBe('Mensualité payée avec succès.');
    expect(component.repaymentErrorMessage()).toBeNull();
  });

  it("2. refuse le remboursement d'une mensualité si le solde est insuffisant", () => {
    const loan = makeLoan();
    const repayment = makeRepayment();
    const { component, httpMock, user } = setup(loan, [repayment], { walletBalance: 1000 });

    component.repaymentForm.patchValue({ repaymentId: repayment.id });
    // Le solde insuffisant est déjà détecté par la validation asynchrone du
    // contrôle `repaymentId` (revérifié côté serveur), qui bloque la
    // soumission avant même d'atteindre la relecture défensive de `payInstallment`.
    flushRepaymentCheck(httpMock, loan, repayment, user);
    component.payInstallment();

    httpMock.expectNone(`${API}/transactions`);
    httpMock.expectNone(`${API}/loans/${loan.id}`);
    expect(component.repaymentErrorMessage()).toBe('Solde insuffisant pour payer cette mensualité.');
    expect(component.repaymentSubmitting()).toBe(false);
  });

  it('3. rembourse le solde total avec succès et solde le prêt', () => {
    const loan = makeLoan({ remainingBalance: 52500 });
    const rp1 = makeRepayment({ id: 'rp1', installmentNumber: 3, status: RepaymentStatus.PLANIFIE });
    const rp2 = makeRepayment({ id: 'rp2', installmentNumber: 4, status: RepaymentStatus.EN_RETARD });
    const { component, httpMock, user } = setup(loan, [rp1, rp2]);

    component.payTotal();
    expect(component.pendingAction()).toBe('total');
    httpMock.expectNone(`${API}/transactions`);

    component.onConfirmModalConfirm();

    flushFreshLoan(httpMock, loan, [rp1, rp2], user);

    const txReq = httpMock.expectOne(`${API}/transactions`);
    expect(txReq.request.body.type).toBe(TransactionType.REMBOURSEMENT_PRET);
    expect(txReq.request.body.amount).toBe(52500);
    txReq.flush({ id: 'tx2', ...txReq.request.body });

    const userReq = httpMock.expectOne(`${API}/users/${USER_ID}`);
    expect(userReq.request.body).toEqual({ walletBalance: 47500 });
    userReq.flush({ ...makeUser(), walletBalance: 47500 });

    const loanReq = httpMock.expectOne(`${API}/loans/${loan.id}`);
    expect(loanReq.request.body.remainingBalance).toBe(0);
    expect(loanReq.request.body.status).toBe(LoanStatus.REMBOURSE);
    loanReq.flush({ ...loan, remainingBalance: 0, status: LoanStatus.REMBOURSE });

    const rp1Req = httpMock.expectOne(`${API}/repayments/rp1`);
    expect(rp1Req.request.body.status).toBe(RepaymentStatus.PAYE);
    rp1Req.flush({ ...rp1, status: RepaymentStatus.PAYE });

    const rp2Req = httpMock.expectOne(`${API}/repayments/rp2`);
    expect(rp2Req.request.body.status).toBe(RepaymentStatus.PAYE);
    rp2Req.flush({ ...rp2, status: RepaymentStatus.PAYE });

    flushRefresh(
      httpMock,
      { ...loan, remainingBalance: 0, status: LoanStatus.REMBOURSE },
      [
        { ...rp1, status: RepaymentStatus.PAYE },
        { ...rp2, status: RepaymentStatus.PAYE },
      ],
    );

    expect(component.repaymentSuccessMessage()).toBe('Prêt intégralement remboursé avec succès.');
    expect(component.repaymentSubmitting()).toBe(false);
  });

  it('4. refuse le remboursement total si le solde est insuffisant', () => {
    const loan = makeLoan({ remainingBalance: 52500 });
    const { component, httpMock } = setup(loan, [], { walletBalance: 10000 });

    component.payTotal();

    httpMock.expectNone(`${API}/transactions`);
    httpMock.expectNone(`${API}/loans/${loan.id}`);
    expect(component.repaymentErrorMessage()).toBe('Solde insuffisant pour rembourser le solde total.');
    expect(component.repaymentSubmitting()).toBe(false);
  });

  it('5. refuse tout remboursement sur un prêt déjà remboursé', () => {
    const loan = makeLoan({ status: LoanStatus.REMBOURSE, remainingBalance: 0 });
    const { component, httpMock } = setup(loan, []);

    component.payTotal();
    httpMock.expectNone(`${API}/transactions`);
    expect(component.repaymentErrorMessage()).toBe("Ce prêt n'est pas éligible au remboursement.");

    component.payInstallment();
    httpMock.expectNone(`${API}/transactions`);
    expect(component.repaymentErrorMessage()).toBe("Ce prêt n'est pas éligible au remboursement.");
  });

  it("6. refuse le paiement d'une mensualité déjà payée", () => {
    const loan = makeLoan();
    const paidRepayment = makeRepayment({ status: RepaymentStatus.PAYE, amountPaid: 26250 });
    const { component, httpMock, user } = setup(loan, [paidRepayment]);

    component.repaymentForm.patchValue({ repaymentId: paidRepayment.id });
    flushRepaymentCheck(httpMock, loan, paidRepayment, user);
    component.payInstallment();

    httpMock.expectNone(`${API}/transactions`);
    expect(component.repaymentErrorMessage()).toBe("Cette mensualité n'est plus payable.");
  });

  it('7. empêche la double soumission du paiement', () => {
    const loan = makeLoan();
    const repayment = makeRepayment();
    const { component, httpMock, user } = setup(loan, [repayment]);

    component.repaymentForm.patchValue({ repaymentId: repayment.id });
    flushRepaymentCheck(httpMock, loan, repayment, user);
    component.payInstallment();
    // Simule un double-clic sur le bouton "Confirmer" de la modale : le
    // second appel doit être ignoré tant que le premier est en cours.
    component.onConfirmModalConfirm();
    component.onConfirmModalConfirm();

    const loanRequests = httpMock.match(`${API}/loans/${loan.id}`);
    expect(loanRequests.length).toBe(1);
    loanRequests[0].flush(loan);

    const repRequests = httpMock.match(`${API}/repayments/${repayment.id}`);
    expect(repRequests.length).toBe(1);
    repRequests[0].flush(repayment);

    const freshUserRequests = httpMock.match(`${API}/users/${USER_ID}`);
    expect(freshUserRequests.length).toBe(1);
    freshUserRequests[0].flush(user);

    const txRequests = httpMock.match(`${API}/transactions`);
    expect(txRequests.length).toBe(1);
    txRequests[0].flush({ id: 'tx1', ...txRequests[0].request.body });

    httpMock.expectOne(`${API}/users/${USER_ID}`).flush({ ...makeUser(), walletBalance: 73750 });
    httpMock
      .expectOne(`${API}/repayments/${repayment.id}`)
      .flush({ ...repayment, status: RepaymentStatus.PAYE, amountPaid: 26250 });
    httpMock.expectOne(`${API}/loans/${loan.id}`).flush({ ...loan, remainingBalance: 26250 });
    flushRefresh(httpMock, { ...loan, remainingBalance: 26250 }, [
      { ...repayment, status: RepaymentStatus.PAYE },
    ]);
  });

  it("8. gère l'échec de l'appel API lors du remboursement", () => {
    const loan = makeLoan();
    const repayment = makeRepayment();
    const { component, httpMock, user } = setup(loan, [repayment]);

    component.repaymentForm.patchValue({ repaymentId: repayment.id });
    flushRepaymentCheck(httpMock, loan, repayment, user);
    component.payInstallment();
    component.onConfirmModalConfirm();

    flushFreshLoanAndInstallment(httpMock, loan, repayment, user);

    const txReq = httpMock.expectOne(`${API}/transactions`);
    txReq.flush('Erreur serveur', { status: 500, statusText: 'Server Error' });

    expect(component.repaymentErrorMessage()).toBe("Impossible d'effectuer le remboursement. Veuillez réessayer.");
    expect(component.repaymentSubmitting()).toBe(false);
    // La modale ne doit pas masquer l'erreur : elle se referme pour laisser
    // apparaître le message d'erreur existant de la page.
    expect(component.pendingAction()).toBeNull();
    httpMock.expectNone(`${API}/users/${USER_ID}`);
  });

  it('9. met à jour correctement le capital restant dû du prêt', () => {
    const loan = makeLoan({ remainingBalance: 26250 });
    const repayment = makeRepayment();
    const { component, httpMock, user } = setup(loan, [repayment]);

    component.repaymentForm.patchValue({ repaymentId: repayment.id });
    flushRepaymentCheck(httpMock, loan, repayment, user);
    component.payInstallment();
    component.onConfirmModalConfirm();

    flushFreshLoanAndInstallment(httpMock, loan, repayment, user);

    const txReq = httpMock.expectOne(`${API}/transactions`);
    txReq.flush({ id: 'tx1', ...txReq.request.body });
    httpMock.expectOne(`${API}/users/${USER_ID}`).flush({ ...makeUser(), walletBalance: 73750 });
    httpMock
      .expectOne(`${API}/repayments/${repayment.id}`)
      .flush({ ...repayment, status: RepaymentStatus.PAYE });

    const loanReq = httpMock.expectOne(`${API}/loans/${loan.id}`);
    expect(loanReq.request.body).toEqual({
      remainingBalance: 0,
      status: LoanStatus.REMBOURSE,
      endDate: expect.any(String),
    });
    loanReq.flush({ ...loan, remainingBalance: 0, status: LoanStatus.REMBOURSE });

    flushRefresh(httpMock, { ...loan, remainingBalance: 0, status: LoanStatus.REMBOURSE }, [
      { ...repayment, status: RepaymentStatus.PAYE },
    ]);
  });

  it("9b. ne déduit que le capital de remainingBalance quand la mensualité payée inclut une pénalité de retard", () => {
    const loan = makeLoan({ remainingBalance: 60000 });
    const repayment = makeRepayment({ status: RepaymentStatus.EN_RETARD, lateFee: 1500 });
    const { component, httpMock, user } = setup(loan, [repayment]);

    component.repaymentForm.patchValue({ repaymentId: repayment.id });
    flushRepaymentCheck(httpMock, loan, repayment, user);
    component.payInstallment();
    component.onConfirmModalConfirm();

    flushFreshLoanAndInstallment(httpMock, loan, repayment, user);

    const txReq = httpMock.expectOne(`${API}/transactions`);
    expect(txReq.request.body.amount).toBe(27750); // amountDue (26250) + lateFee (1500)
    txReq.flush({ id: 'tx1', ...txReq.request.body });
    httpMock.expectOne(`${API}/users/${USER_ID}`).flush({ ...makeUser(), walletBalance: 72250 });
    httpMock
      .expectOne(`${API}/repayments/${repayment.id}`)
      .flush({ ...repayment, status: RepaymentStatus.PAYE, amountPaid: 27750 });

    const loanReq = httpMock.expectOne(`${API}/loans/${loan.id}`);
    expect(loanReq.request.body).toEqual({ remainingBalance: 33750 });
    loanReq.flush({ ...loan, remainingBalance: 33750 });

    flushRefresh(httpMock, { ...loan, remainingBalance: 33750 }, [
      { ...repayment, status: RepaymentStatus.PAYE, amountPaid: 27750 },
    ]);
  });

  it('4. rembourse la dernière échéance en retard et fait repasser le prêt de EN_RETARD à EN_COURS', () => {
    const loan = makeLoan({ status: LoanStatus.EN_RETARD, remainingBalance: 52500 });
    const repayment = makeRepayment({ status: RepaymentStatus.EN_RETARD, lateFee: 1000 });
    const { component, httpMock, user } = setup(loan, [repayment]);

    component.repaymentForm.patchValue({ repaymentId: repayment.id });
    flushRepaymentCheck(httpMock, loan, repayment, user);
    component.payInstallment();
    component.onConfirmModalConfirm();

    flushFreshLoanAndInstallment(httpMock, loan, repayment, user);

    const txReq = httpMock.expectOne(`${API}/transactions`);
    expect(txReq.request.body.amount).toBe(27250); // amountDue (26250) + lateFee (1000)
    txReq.flush({ id: 'tx1', ...txReq.request.body });

    httpMock.expectOne(`${API}/users/${USER_ID}`).flush({ ...makeUser(), walletBalance: 72750 });
    httpMock
      .expectOne(`${API}/repayments/${repayment.id}`)
      .flush({ ...repayment, status: RepaymentStatus.PAYE, amountPaid: 27250 });

    const loanReq = httpMock.expectOne(`${API}/loans/${loan.id}`);
    expect(loanReq.request.method).toBe('PATCH');
    expect(loanReq.request.body).toEqual({ remainingBalance: 26250, status: LoanStatus.EN_COURS });
    loanReq.flush({ ...loan, remainingBalance: 26250, status: LoanStatus.EN_COURS });

    flushRefresh(httpMock, { ...loan, remainingBalance: 26250, status: LoanStatus.EN_COURS }, [
      { ...repayment, status: RepaymentStatus.PAYE, amountPaid: 27250 },
    ]);

    expect(component.repaymentSuccessMessage()).toBe('Mensualité payée avec succès.');
  });

  it('reste EN_RETARD après paiement si une autre échéance du prêt est encore en retard', () => {
    const loan = makeLoan({ status: LoanStatus.EN_RETARD, remainingBalance: 78750 });
    const paidNow = makeRepayment({ id: 'rp1', installmentNumber: 3, status: RepaymentStatus.EN_RETARD });
    const stillLate = makeRepayment({ id: 'rp2', installmentNumber: 4, status: RepaymentStatus.EN_RETARD });
    const { component, httpMock, user } = setup(loan, [paidNow, stillLate]);

    component.repaymentForm.patchValue({ repaymentId: paidNow.id });
    flushRepaymentCheck(httpMock, loan, paidNow, user);
    component.payInstallment();
    component.onConfirmModalConfirm();

    flushFreshLoanAndInstallment(httpMock, loan, paidNow, user);

    const txReq = httpMock.expectOne(`${API}/transactions`);
    txReq.flush({ id: 'tx1', ...txReq.request.body });

    httpMock.expectOne(`${API}/users/${USER_ID}`).flush({ ...makeUser(), walletBalance: 73750 });
    httpMock
      .expectOne(`${API}/repayments/${paidNow.id}`)
      .flush({ ...paidNow, status: RepaymentStatus.PAYE, amountPaid: 26250 });

    const loanReq = httpMock.expectOne(`${API}/loans/${loan.id}`);
    expect(loanReq.request.method).toBe('PATCH');
    // Le prêt reste EN_RETARD (rp2 non régularisée) : le PATCH ne porte que sur le capital restant dû.
    expect(loanReq.request.body).toEqual({ remainingBalance: 52500 });
    loanReq.flush({ ...loan, remainingBalance: 52500 });

    flushRefresh(httpMock, { ...loan, remainingBalance: 52500 }, [
      { ...paidNow, status: RepaymentStatus.PAYE, amountPaid: 26250 },
      stillLate,
    ]);
  });

  it('10. crée une transaction REMBOURSEMENT_PRET correcte', () => {
    const loan = makeLoan();
    const repayment = makeRepayment();
    const { component, httpMock, user } = setup(loan, [repayment]);

    component.repaymentForm.patchValue({ repaymentId: repayment.id });
    flushRepaymentCheck(httpMock, loan, repayment, user);
    component.payInstallment();
    component.onConfirmModalConfirm();

    flushFreshLoanAndInstallment(httpMock, loan, repayment, user);

    const txReq = httpMock.expectOne(`${API}/transactions`);
    expect(txReq.request.body.type).toBe(TransactionType.REMBOURSEMENT_PRET);
    expect(txReq.request.body.status).toBe(TransactionStatus.REUSSIE);
    expect(txReq.request.body.amount).toBe(26250);
    expect(txReq.request.body.senderId).toBe(USER_ID);
    expect(txReq.request.body.relatedLoanId).toBe(loan.id);
    txReq.flush({ id: 'tx1', ...txReq.request.body });

    httpMock.expectOne(`${API}/users/${USER_ID}`).flush({ ...makeUser(), walletBalance: 73750 });
    httpMock
      .expectOne(`${API}/repayments/${repayment.id}`)
      .flush({ ...repayment, status: RepaymentStatus.PAYE });
    httpMock.expectOne(`${API}/loans/${loan.id}`).flush({ ...loan, remainingBalance: 26250 });
    flushRefresh(httpMock, { ...loan, remainingBalance: 26250 }, [
      { ...repayment, status: RepaymentStatus.PAYE },
    ]);
  });

  it('11. débite correctement le solde du client', () => {
    const loan = makeLoan();
    const repayment = makeRepayment();
    const { component, httpMock, user } = setup(loan, [repayment], { walletBalance: 100000 });

    component.repaymentForm.patchValue({ repaymentId: repayment.id });
    flushRepaymentCheck(httpMock, loan, repayment, user);
    component.payInstallment();
    component.onConfirmModalConfirm();

    flushFreshLoanAndInstallment(httpMock, loan, repayment, user);

    const txReq = httpMock.expectOne(`${API}/transactions`);
    txReq.flush({ id: 'tx1', ...txReq.request.body });

    const userReq = httpMock.expectOne(`${API}/users/${USER_ID}`);
    expect(userReq.request.body).toEqual({ walletBalance: 73750 });
    userReq.flush({ ...makeUser(), walletBalance: 73750 });

    httpMock
      .expectOne(`${API}/repayments/${repayment.id}`)
      .flush({ ...repayment, status: RepaymentStatus.PAYE });
    httpMock.expectOne(`${API}/loans/${loan.id}`).flush({ ...loan, remainingBalance: 26250 });
    flushRefresh(httpMock, { ...loan, remainingBalance: 26250 }, [
      { ...repayment, status: RepaymentStatus.PAYE },
    ]);

    expect(component.walletBalance()).toBe(73750);
  });

  it('empêche un client suspendu de rembourser une mensualité ou le solde total', () => {
    const loan = makeLoan();
    const repayment = makeRepayment();
    const { component, httpMock, user } = setup(loan, [repayment], { status: UserStatus.SUSPENDED });

    expect(component.accountSuspended()).toBe(true);

    component.repaymentForm.patchValue({ repaymentId: repayment.id });
    flushRepaymentCheck(httpMock, loan, repayment, user);

    component.payInstallment();
    expect(component.canPayInstallment()).toBe(false);
    expect(component.repaymentErrorMessage()).toBe(
      'Votre compte est suspendu. Vous ne pouvez plus effectuer de remboursement.',
    );

    component.payTotal();
    expect(component.canPayTotal()).toBe(false);
  });
});

describe('ClientLoanDetailComponent - Chargement', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('charge le prêt et son échéancier', () => {
    const loan = makeLoan();
    const repayment = makeRepayment();
    const { component } = setup(loan, [repayment]);

    expect(component.loan()?.id).toBe(loan.id);
    expect(component.sortedSchedule().length).toBe(1);
  });

  it('reclasse une échéance PLANIFIE dépassée en EN_RETARD au chargement', () => {
    const loan = makeLoan();
    const overdue = makeRepayment({ status: RepaymentStatus.PLANIFIE, dueDate: '2026-08-01T00:00:00.000Z' });
    const { component } = setup(loan, [overdue]);

    const updated = component.repayments().find((r) => r.id === overdue.id);
    expect(updated?.status).toBe(RepaymentStatus.EN_RETARD);
  });

  it('2. fait réellement passer le prêt EN_COURS à EN_RETARD quand une de ses échéances devient EN_RETARD', () => {
    const loan = makeLoan({ status: LoanStatus.EN_COURS });
    const overdue = makeRepayment({ status: RepaymentStatus.PLANIFIE, dueDate: '2026-08-01T00:00:00.000Z' });
    const { component } = setup(loan, [overdue]);

    expect(component.loan()?.status).toBe(LoanStatus.EN_RETARD);
  });

  it("ne touche pas le statut du prêt si aucune de ses échéances n'est en retard", () => {
    const loan = makeLoan({ status: LoanStatus.EN_COURS });
    const upcoming = makeRepayment({ status: RepaymentStatus.PLANIFIE, dueDate: '2999-01-01T00:00:00.000Z' });
    const { component } = setup(loan, [upcoming]);

    expect(component.loan()?.status).toBe(LoanStatus.EN_COURS);
  });

  it("refuse l'accès à un prêt qui n'appartient pas à l'utilisateur connecté", () => {
    const loan = makeLoan({ userId: 'other-user' });
    const { component } = setup(loan, []);

    expect(component.error()).toBe('Prêt introuvable.');
    expect(component.loan()).toBeNull();
  });
});
