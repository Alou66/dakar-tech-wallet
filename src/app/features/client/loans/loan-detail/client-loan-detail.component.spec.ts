import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { provideRouter } from '@angular/router';

import { ClientLoanDetailComponent } from './client-loan-detail.component';
import { AuthService } from '../../../../core/services/auth.service';
import { environment } from '../../../../../environments/environment';
import { Loan, LoanStatus } from '../../../../core/models/loan.model';
import { Repayment, RepaymentStatus } from '../../../../core/models/repayment.model';
import { User, UserRole, UserStatus } from '../../../../core/models/user.model';

const API = environment.apiUrl;
const LOAN_ID = 'loan1';

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'u1',
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
    id: LOAN_ID,
    userId: 'u1',
    amount: 100000,
    interestRate: 5,
    durationMonths: 4,
    monthlyPayment: 26250,
    remainingBalance: 26250,
    status: LoanStatus.EN_COURS,
    requestDate: '2026-01-01T00:00:00.000Z',
    startDate: '2026-01-05T00:00:00.000Z',
    ...overrides,
  };
}

function makeInstallment(overrides: Partial<Repayment> = {}): Repayment {
  return {
    id: 'rp1',
    loanId: LOAN_ID,
    userId: 'u1',
    installmentNumber: 4,
    dueDate: '2026-08-05T00:00:00.000Z',
    amountDue: 26250,
    status: RepaymentStatus.PLANIFIE,
    ...overrides,
  };
}

function setup(user: User) {
  TestBed.configureTestingModule({
    imports: [ClientLoanDetailComponent],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      { provide: AuthService, useValue: { getCurrentUser: () => user } },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: LOAN_ID }) } } },
    ],
  });

  const httpMock = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(ClientLoanDetailComponent);
  const component = fixture.componentInstance;
  fixture.detectChanges();

  return { component, httpMock };
}

/** Flushe le chargement initial (forkJoin loan+repayments) puis la vérification de suspension (GET /users/:id). */
function flushInitialLoad(httpMock: HttpTestingController, user: User, loan: Loan, repayments: Repayment[]): void {
  httpMock.expectOne(`${API}/loans/${loan.id}`).flush(loan);
  httpMock.expectOne(`${API}/repayments/loan/${loan.id}`).flush(repayments);
  httpMock.expectOne(`${API}/users/${user.id}`).flush(user);
}

describe('ClientLoanDetailComponent', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('charge le prêt et son échéancier au démarrage', () => {
    const user = makeUser();
    const { component, httpMock } = setup(user);
    const loan = makeLoan();
    const installment = makeInstallment();

    flushInitialLoad(httpMock, user, loan, [installment]);

    expect(component.loan()).toEqual(loan);
    expect(component.sortedSchedule()).toHaveLength(1);
    expect(component.loading()).toBe(false);
  });

  it('détecte un compte suspendu depuis le profil rafraîchi et bloque le remboursement', () => {
    const user = makeUser();
    const { component, httpMock } = setup(user);
    flushInitialLoad(httpMock, { ...user, status: UserStatus.SUSPENDED }, makeLoan(), [makeInstallment()]);

    expect(component.accountSuspended()).toBe(true);
    component.repaymentForm.get('repaymentId')?.setValue('rp1');
    expect(component.canPayInstallment()).toBe(false);
  });

  it('paie une mensualité en un seul appel atomique et rafraîchit prêt, échéancier et solde', () => {
    const user = makeUser({ walletBalance: 50000 });
    const { component, httpMock } = setup(user);
    const loan = makeLoan({ remainingBalance: 26250 });
    const installment = makeInstallment({ amountDue: 26250 });

    flushInitialLoad(httpMock, user, loan, [installment]);

    component.repaymentForm.get('repaymentId')?.setValue('rp1');
    expect(component.canPayInstallment()).toBe(true);

    component.payInstallment();
    expect(component.pendingAction()).toBe('installment');
    component.onConfirmModalConfirm();

    const payReq = httpMock.expectOne(`${API}/repayments/rp1/pay`);
    expect(payReq.request.method).toBe('POST');
    payReq.flush({ ...installment, status: RepaymentStatus.PAYE, amountPaid: 26250 });

    // Rafraîchissement après paiement : prêt, échéancier, solde.
    const updatedLoan = { ...loan, remainingBalance: 0, status: LoanStatus.REMBOURSE };
    httpMock.expectOne(`${API}/loans/${loan.id}`).flush(updatedLoan);
    httpMock.expectOne(`${API}/repayments/loan/${loan.id}`).flush([{ ...installment, status: RepaymentStatus.PAYE }]);
    httpMock.expectOne(`${API}/users/${user.id}`).flush({ ...user, walletBalance: 23750 });

    expect(component.repaymentSuccessMessage()).toBe('Mensualité payée avec succès.');
    expect(component.loan()?.status).toBe(LoanStatus.REMBOURSE);
    expect(component.walletBalance()).toBe(23750);
  });

  it('rembourse le solde total en un seul appel atomique', () => {
    const user = makeUser({ walletBalance: 50000 });
    const { component, httpMock } = setup(user);
    const loan = makeLoan({ remainingBalance: 26250 });

    flushInitialLoad(httpMock, user, loan, [makeInstallment()]);

    expect(component.canPayTotal()).toBe(true);
    component.payTotal();
    expect(component.pendingAction()).toBe('total');
    component.onConfirmModalConfirm();

    const payReq = httpMock.expectOne(`${API}/repayments/loan/${loan.id}/pay-total`);
    expect(payReq.request.method).toBe('POST');
    payReq.flush(null, { status: 204, statusText: 'No Content' });

    httpMock.expectOne(`${API}/loans/${loan.id}`).flush({ ...loan, remainingBalance: 0, status: LoanStatus.REMBOURSE });
    httpMock.expectOne(`${API}/repayments/loan/${loan.id}`).flush([]);
    httpMock.expectOne(`${API}/users/${user.id}`).flush({ ...user, walletBalance: 23750 });

    expect(component.repaymentSuccessMessage()).toBe('Prêt intégralement remboursé avec succès.');
  });

  it('empêche de rembourser au-delà du solde disponible', () => {
    const user = makeUser({ walletBalance: 100 });
    const { component, httpMock } = setup(user);
    const loan = makeLoan({ remainingBalance: 26250 });

    flushInitialLoad(httpMock, user, loan, [makeInstallment()]);

    expect(component.canPayTotal()).toBe(false);
    component.payTotal();
    expect(component.pendingAction()).toBeNull();
    httpMock.expectNone(`${API}/repayments/loan/${loan.id}/pay-total`);
  });

  it("affiche le message d'erreur renvoyé par le serveur en cas d'échec, tout en rafraîchissant l'état", () => {
    const user = makeUser({ walletBalance: 50000 });
    const { component, httpMock } = setup(user);
    const loan = makeLoan({ remainingBalance: 26250 });
    const installment = makeInstallment();

    flushInitialLoad(httpMock, user, loan, [installment]);

    component.repaymentForm.get('repaymentId')?.setValue('rp1');
    component.payInstallment();
    component.onConfirmModalConfirm();

    httpMock
      .expectOne(`${API}/repayments/rp1/pay`)
      .flush({ message: "Cette mensualité n'est plus payable." }, { status: 409, statusText: 'Conflict' });

    httpMock.expectOne(`${API}/loans/${loan.id}`).flush(loan);
    httpMock.expectOne(`${API}/repayments/loan/${loan.id}`).flush([installment]);
    httpMock.expectOne(`${API}/users/${user.id}`).flush(user);

    expect(component.repaymentErrorMessage()).toBe("Cette mensualité n'est plus payable.");
    expect(component.repaymentSubmitting()).toBe(false);
    expect(component.pendingAction()).toBeNull();
  });

  it('affiche une erreur et permet de réessayer si le chargement du prêt échoue', () => {
    const user = makeUser();
    const { component, httpMock } = setup(user);

    httpMock.expectOne(`${API}/loans/${LOAN_ID}`).flush('Erreur', { status: 500, statusText: 'Server Error' });
    httpMock.match(`${API}/repayments/loan/${LOAN_ID}`).filter((r) => !r.cancelled).forEach((r) => r.flush([]));
    httpMock.expectOne(`${API}/users/${user.id}`).flush(user);

    expect(component.error()).toBe('Impossible de charger ce prêt.');
    expect(component.loading()).toBe(false);

    component.retry();
    httpMock.expectOne(`${API}/loans/${LOAN_ID}`).flush(makeLoan());
    httpMock.expectOne(`${API}/repayments/loan/${LOAN_ID}`).flush([]);

    expect(component.error()).toBeNull();
    expect(component.loan()).not.toBeNull();
  });

  it("n'affiche pas les actions de remboursement pour un prêt non remboursable (ex: déjà soldé)", () => {
    const user = makeUser();
    const { component, httpMock } = setup(user);
    const loan = makeLoan({ status: LoanStatus.REMBOURSE, remainingBalance: 0 });

    flushInitialLoad(httpMock, user, loan, []);

    expect(component.isRepayableLoan(loan)).toBe(false);
    expect(component.canPayTotal()).toBe(false);
  });
});
