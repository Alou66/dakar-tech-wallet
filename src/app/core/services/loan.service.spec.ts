import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { LoanService } from './loan.service';
import { environment } from '../../../environments/environment';
import { Loan, LoanStatus } from '../models/loan.model';
import { Repayment, RepaymentStatus } from '../models/repayment.model';

const API = environment.apiUrl;

function makeLoan(overrides: Partial<Loan> = {}): Loan {
  return {
    id: 'loan1',
    userId: 'u1',
    amount: 100000,
    interestRate: 5,
    durationMonths: 3,
    monthlyPayment: 35000,
    remainingBalance: 70000,
    status: LoanStatus.EN_COURS,
    requestDate: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeRepayment(overrides: Partial<Repayment> = {}): Repayment {
  return {
    id: 'rp1',
    loanId: 'loan1',
    userId: 'u1',
    installmentNumber: 1,
    dueDate: '2026-08-01T00:00:00.000Z',
    amountDue: 35000,
    status: RepaymentStatus.PLANIFIE,
    ...overrides,
  };
}

describe('LoanService - syncStatusFromRepayments', () => {
  let service: LoanService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(LoanService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it("2. fait réellement passer un prêt EN_COURS avec une échéance EN_RETARD à EN_RETARD (persisté)", () => {
    const loan = makeLoan({ status: LoanStatus.EN_COURS });
    const repayments = [makeRepayment({ status: RepaymentStatus.EN_RETARD })];

    let result: Loan | undefined;
    service.syncStatusFromRepayments(loan, repayments).subscribe((l) => (result = l));

    const req = httpMock.expectOne(`${API}/loans/${loan.id}`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ status: LoanStatus.EN_RETARD });
    req.flush({ ...loan, status: LoanStatus.EN_RETARD });

    expect(result?.status).toBe(LoanStatus.EN_RETARD);
  });

  it('4. fait repasser un prêt EN_RETARD à EN_COURS une fois sa dernière échéance en retard régularisée', () => {
    const loan = makeLoan({ status: LoanStatus.EN_RETARD });
    const repayments = [makeRepayment({ status: RepaymentStatus.PAYE, amountPaid: 35000 })];

    let result: Loan | undefined;
    service.syncStatusFromRepayments(loan, repayments).subscribe((l) => (result = l));

    const req = httpMock.expectOne(`${API}/loans/${loan.id}`);
    expect(req.request.body).toEqual({ status: LoanStatus.EN_COURS });
    req.flush({ ...loan, status: LoanStatus.EN_COURS });

    expect(result?.status).toBe(LoanStatus.EN_COURS);
  });

  it("n'envoie aucune requête si le statut dérivé est déjà celui du prêt (idempotence)", () => {
    const loan = makeLoan({ status: LoanStatus.EN_RETARD });
    const repayments = [makeRepayment({ status: RepaymentStatus.EN_RETARD })];

    let result: Loan | undefined;
    service.syncStatusFromRepayments(loan, repayments).subscribe((l) => (result = l));

    httpMock.expectNone(() => true);
    expect(result).toBe(loan);
  });

  it("ne fait jamais basculer un prêt REMBOURSE, même avec une échéance en retard", () => {
    const loan = makeLoan({ status: LoanStatus.REMBOURSE, remainingBalance: 0 });
    const repayments = [makeRepayment({ status: RepaymentStatus.EN_RETARD })];

    let result: Loan | undefined;
    service.syncStatusFromRepayments(loan, repayments).subscribe((l) => (result = l));

    httpMock.expectNone(() => true);
    expect(result).toBe(loan);
  });
});
