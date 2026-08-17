import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { ClientLoansListComponent } from './client-loans-list.component';
import { AuthService } from '../../../../core/services/auth.service';
import { environment } from '../../../../../environments/environment';
import { Loan, LoanStatus } from '../../../../core/models/loan.model';
import { Repayment, RepaymentStatus } from '../../../../core/models/repayment.model';
import { User, UserRole, UserStatus } from '../../../../core/models/user.model';
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

function setup(loans: Loan[], repayments: Repayment[], userOverrides: Partial<User> = {}) {
  const user = makeUser(userOverrides);

  TestBed.configureTestingModule({
    imports: [ClientLoansListComponent],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      { provide: AuthService, useValue: { getCurrentUser: () => user, currentUser: () => user } },
    ],
  });

  const httpMock = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(ClientLoansListComponent);
  const component = fixture.componentInstance;
  fixture.detectChanges();

  httpMock.expectOne((req) => req.url === `${API}/loans` && req.params.get('userId') === USER_ID).flush(loans);
  httpMock
    .expectOne((req) => req.url === `${API}/repayments` && req.params.get('userId') === USER_ID)
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

  // Une fois l'échéancier reclassé, le statut de chaque prêt est aligné
  // dessus (voir `LoanService.syncStatusFromRepayments`) : on flushe le
  // PATCH correspondant pour chaque prêt dont le statut en résulte changé.
  const repaymentsAfterSync = repayments.map((r) =>
    overdueIds.has(r.id) ? { ...r, status: RepaymentStatus.EN_RETARD } : r,
  );
  for (const loan of loans) {
    const loanRepayments = repaymentsAfterSync.filter((r) => r.loanId === loan.id);
    const nextLoanStatus = deriveLoanStatus(loan, loanRepayments);
    if (nextLoanStatus !== loan.status) {
      const loanStatusReq = httpMock.expectOne(`${API}/loans/${loan.id}`);
      expect(loanStatusReq.request.method).toBe('PATCH');
      expect(loanStatusReq.request.body).toEqual({ status: nextLoanStatus });
      loanStatusReq.flush({ ...loan, status: nextLoanStatus });
    }
  }

  const getReq = httpMock.expectOne(
    (req) => req.url === `${API}/creditScores` && req.params.get('userId') === USER_ID,
  );
  getReq.flush([]);

  const postReq = httpMock.expectOne(`${API}/creditScores`);
  expect(postReq.request.method).toBe('POST');
  postReq.flush({ id: 'cs-new', ...postReq.request.body });

  httpMock.expectOne(`${API}/users/${USER_ID}`).flush(user);

  return { component, httpMock, user };
}

describe('ClientLoansListComponent', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('charge les prêts et calcule le score à partir de l’historique réel', () => {
    const loan = makeLoan();
    const onTime = makeRepayment({
      id: 'rp-on-time',
      status: RepaymentStatus.PAYE,
      dueDate: '2026-06-01T00:00:00.000Z',
      paymentDate: '2026-06-01T00:00:00.000Z',
      amountPaid: 26250,
    });
    const late = makeRepayment({
      id: 'rp-late',
      installmentNumber: 2,
      status: RepaymentStatus.EN_RETARD,
      dueDate: '2026-07-01T00:00:00.000Z',
    });
    const { component } = setup([loan], [onTime, late]);

    expect(component.sortedLoans().length).toBe(1);
    const breakdown = component.creditScoreBreakdown();
    expect(breakdown.onTimeCount).toBe(1);
    expect(breakdown.lateCount).toBe(1);
    expect(breakdown.score).toBeGreaterThanOrEqual(0);
    expect(breakdown.score).toBeLessThanOrEqual(100);
  });

  it('client sans historique : score de base, sans erreur', () => {
    const loan = makeLoan({ status: LoanStatus.EN_ATTENTE, remainingBalance: 0 });
    const { component } = setup([loan], []);

    const breakdown = component.creditScoreBreakdown();
    expect(breakdown.onTimeCount).toBe(0);
    expect(breakdown.lateCount).toBe(0);
    expect(component.creditScoreError()).toBeNull();
  });

  it('reclasse une échéance PLANIFIE dépassée en EN_RETARD au chargement', () => {
    const loan = makeLoan();
    const overdue = makeRepayment({ status: RepaymentStatus.PLANIFIE, dueDate: '2026-08-01T00:00:00.000Z' });
    const { component } = setup([loan], [overdue]);

    const updated = component.repayments().find((r) => r.id === overdue.id);
    expect(updated?.status).toBe(RepaymentStatus.EN_RETARD);
  });

  it('détecte un compte suspendu et le reflète dans le signal accountSuspended', () => {
    const loan = makeLoan();
    const { component } = setup([loan], [], { status: UserStatus.SUSPENDED });

    expect(component.accountSuspended()).toBe(true);
  });

  it("affiche une erreur et permet de réessayer si le chargement échoue", () => {
    const user = makeUser();
    TestBed.configureTestingModule({
      imports: [ClientLoansListComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: AuthService, useValue: { getCurrentUser: () => user, currentUser: () => user } },
      ],
    });
    const httpMock = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(ClientLoansListComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges();

    httpMock
      .expectOne((req) => req.url === `${API}/repayments` && req.params.get('userId') === USER_ID)
      .flush([]);
    httpMock
      .expectOne((req) => req.url === `${API}/loans` && req.params.get('userId') === USER_ID)
      .flush('Erreur', { status: 500, statusText: 'Server Error' });

    expect(component.error()).toBe('Impossible de charger vos prêts.');
    expect(component.loading()).toBe(false);

    httpMock.expectOne(`${API}/users/${USER_ID}`).flush(user);
  });
});
