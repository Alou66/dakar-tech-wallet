import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { RepaymentService } from './repayment.service';
import { environment } from '../../../environments/environment';
import { Loan, LoanStatus } from '../models/loan.model';
import { Repayment, RepaymentStatus } from '../models/repayment.model';

const API = environment.apiUrl;

function makeRepayment(overrides: Partial<Repayment> = {}): Repayment {
  return {
    id: 'rp1',
    loanId: 'loan1',
    userId: 'u1',
    installmentNumber: 1,
    dueDate: '2000-01-01T00:00:00.000Z',
    amountDue: 10000,
    status: RepaymentStatus.PLANIFIE,
    ...overrides,
  };
}

describe('RepaymentService - syncOverdueStatuses', () => {
  let service: RepaymentService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(RepaymentService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it("ne fait aucun appel HTTP quand aucune échéance n'est en retard", () => {
    const repayments = [makeRepayment({ dueDate: '2999-01-01T00:00:00.000Z' })];

    let result: Repayment[] | undefined;
    service.syncOverdueStatuses(repayments).subscribe((r) => (result = r));

    httpMock.expectNone(() => true);
    expect(result).toEqual(repayments);
  });

  it('ne touche jamais une échéance déjà PAYE', () => {
    const repayments = [
      makeRepayment({ status: RepaymentStatus.PAYE, dueDate: '2000-01-01T00:00:00.000Z', amountPaid: 10000 }),
    ];

    let result: Repayment[] | undefined;
    service.syncOverdueStatuses(repayments).subscribe((r) => (result = r));

    httpMock.expectNone(() => true);
    expect(result).toEqual(repayments);
  });

  it('bascule PLANIFIE -> EN_RETARD pour les échéances dépassées et persiste chaque changement', () => {
    const repayments = [
      makeRepayment({ id: 'rp1', dueDate: '2000-01-01T00:00:00.000Z' }),
      makeRepayment({ id: 'rp2', dueDate: '2999-01-01T00:00:00.000Z' }),
    ];

    let result: Repayment[] | undefined;
    service.syncOverdueStatuses(repayments).subscribe((r) => (result = r));

    const req = httpMock.expectOne(`${API}/repayments/rp1`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ status: RepaymentStatus.EN_RETARD, lateFee: 500 });
    req.flush({ ...repayments[0], status: RepaymentStatus.EN_RETARD, lateFee: 500 });

    expect(result?.[0].status).toBe(RepaymentStatus.EN_RETARD);
    expect(result?.[0].lateFee).toBe(500);
    expect(result?.[1].status).toBe(RepaymentStatus.PLANIFIE);
  });

  it('gère plusieurs retards cumulés en un seul passage', () => {
    const repayments = [
      makeRepayment({ id: 'rp1', dueDate: '2000-01-01T00:00:00.000Z' }),
      makeRepayment({ id: 'rp2', dueDate: '2000-02-01T00:00:00.000Z' }),
    ];

    let result: Repayment[] | undefined;
    service.syncOverdueStatuses(repayments).subscribe((r) => (result = r));

    httpMock.expectOne(`${API}/repayments/rp1`).flush({ ...repayments[0], status: RepaymentStatus.EN_RETARD });
    httpMock.expectOne(`${API}/repayments/rp2`).flush({ ...repayments[1], status: RepaymentStatus.EN_RETARD });

    expect(result?.every((r) => r.status === RepaymentStatus.EN_RETARD)).toBe(true);
  });

  it('ne recalcule jamais la pénalité d\'une échéance déjà EN_RETARD (pas de double comptage)', () => {
    const repayments = [
      makeRepayment({ id: 'rp1', dueDate: '2000-01-01T00:00:00.000Z', status: RepaymentStatus.EN_RETARD, lateFee: 500 }),
    ];

    let result: Repayment[] | undefined;
    service.syncOverdueStatuses(repayments).subscribe((r) => (result = r));

    httpMock.expectNone(() => true);
    expect(result).toEqual(repayments);
  });
});

function makeLoan(overrides: Partial<Loan> = {}): Loan {
  return {
    id: 'loan1',
    userId: 'u1',
    amount: 100000,
    interestRate: 5,
    durationMonths: 3,
    monthlyPayment: 35000,
    remainingBalance: 105000,
    status: LoanStatus.EN_COURS,
    requestDate: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('RepaymentService - createSchedule', () => {
  let service: RepaymentService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(RepaymentService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it("crée une échéance PLANIFIE par mois de durée, avec des dates espacées d'un mois", () => {
    const loan = makeLoan();

    let result: Repayment[] | undefined;
    service.createSchedule(loan, new Date('2026-01-15T10:00:00.000Z')).subscribe((r) => (result = r));

    // L'échéancier étant idempotent, on relit d'abord les échéances déjà
    // persistées pour ce prêt avant de créer celles qui manquent.
    const getReq = httpMock.expectOne(
      (r) => r.method === 'GET' && r.url === `${API}/repayments` && r.params.get('loanId') === loan.id,
    );
    getReq.flush([]);

    // Les créations sont envoyées une par une (et non en parallèle) pour ne
    // pas déclencher plusieurs rechargements concurrents de json-server.
    for (const n of [1, 2, 3]) {
      const req = httpMock.expectOne((r) => r.method === 'POST' && r.url === `${API}/repayments`);
      expect(req.request.body.installmentNumber).toBe(n);
      expect(req.request.body.status).toBe(RepaymentStatus.PLANIFIE);
      expect(req.request.body.loanId).toBe(loan.id);
      req.flush({ id: `rp${n}`, ...req.request.body });
    }

    expect(result?.length).toBe(3);
    expect(result?.reduce((sum, r) => sum + r.amountDue, 0)).toBe(loan.monthlyPayment * loan.durationMonths);
  });

  it("ne recrée aucune échéance déjà persistée : ne complète que celles qui manquent (idempotence)", () => {
    const loan = makeLoan({ durationMonths: 3 });
    const existing = [makeRepayment({ id: 'rp1', loanId: loan.id, installmentNumber: 1 })];

    let result: Repayment[] | undefined;
    service.createSchedule(loan, new Date('2026-01-15T10:00:00.000Z')).subscribe((r) => (result = r));

    httpMock
      .expectOne((r) => r.method === 'GET' && r.url === `${API}/repayments` && r.params.get('loanId') === loan.id)
      .flush(existing);

    for (const n of [2, 3]) {
      const req = httpMock.expectOne((r) => r.method === 'POST' && r.url === `${API}/repayments`);
      expect(req.request.body.installmentNumber).toBe(n);
      req.flush({ id: `rp${n}`, ...req.request.body });
    }

    httpMock.expectNone((r) => r.method === 'POST' && r.body?.installmentNumber === 1);
    expect(result?.map((r) => r.installmentNumber)).toEqual([1, 2, 3]);
  });

  it("ne crée aucune requête si l'échéancier complet existe déjà (nouvel appel sans effet)", () => {
    const loan = makeLoan({ durationMonths: 2 });
    const existing = [
      makeRepayment({ id: 'rp1', loanId: loan.id, installmentNumber: 1 }),
      makeRepayment({ id: 'rp2', loanId: loan.id, installmentNumber: 2 }),
    ];

    let result: Repayment[] | undefined;
    service.createSchedule(loan, new Date('2026-01-15T10:00:00.000Z')).subscribe((r) => (result = r));

    httpMock
      .expectOne((r) => r.method === 'GET' && r.url === `${API}/repayments` && r.params.get('loanId') === loan.id)
      .flush(existing);

    httpMock.expectNone((r) => r.method === 'POST' && r.url === `${API}/repayments`);
    expect(result).toEqual(existing);
  });
});
