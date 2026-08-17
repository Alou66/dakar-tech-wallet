import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { CreditScoreService } from './credit-score.service';
import { environment } from '../../../environments/environment';
import { CreditScore, CreditScoreCategory } from '../models/credit-score.model';
import { Repayment, RepaymentStatus } from '../models/repayment.model';

const API = environment.apiUrl;
const USER_ID = 'u1';

function makeRepayment(overrides: Partial<Repayment> = {}): Repayment {
  return {
    id: 'rp1',
    loanId: 'loan1',
    userId: USER_ID,
    installmentNumber: 1,
    dueDate: '2026-06-01T00:00:00.000Z',
    amountDue: 10000,
    status: RepaymentStatus.PAYE,
    amountPaid: 10000,
    paymentDate: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('CreditScoreService - recalculateForUser', () => {
  let service: CreditScoreService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(CreditScoreService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it("crée un enregistrement quand le client n'en a pas encore", () => {
    let result: CreditScore | undefined;
    service.recalculateForUser(USER_ID, [makeRepayment()]).subscribe((r) => (result = r));

    const getReq = httpMock.expectOne(
      (req) => req.url === `${API}/creditScores` && req.params.get('userId') === USER_ID,
    );
    getReq.flush([]);

    const postReq = httpMock.expectOne(`${API}/creditScores`);
    expect(postReq.request.method).toBe('POST');
    expect(postReq.request.body.userId).toBe(USER_ID);
    expect(postReq.request.body.onTimeRepayments).toBe(1);
    expect(postReq.request.body.lateRepayments).toBe(0);
    postReq.flush({ id: 'cs-new', ...postReq.request.body });

    expect(result?.id).toBe('cs-new');
    expect(result?.userId).toBe(USER_ID);
  });

  it('met à jour l’enregistrement existant plutôt que de faire confiance à sa valeur stockée', () => {
    const existing: CreditScore = {
      id: 'cs1',
      userId: USER_ID,
      score: 10,
      category: CreditScoreCategory.MAUVAIS_PAYEUR,
      totalLoans: 5,
      onTimeRepayments: 0,
      lateRepayments: 5,
      calculatedAt: '2020-01-01T00:00:00.000Z',
    };

    let result: CreditScore | undefined;
    service.recalculateForUser(USER_ID, [makeRepayment()]).subscribe((r) => (result = r));

    const getReq = httpMock.expectOne(
      (req) => req.url === `${API}/creditScores` && req.params.get('userId') === USER_ID,
    );
    getReq.flush([existing]);

    const patchReq = httpMock.expectOne(`${API}/creditScores/cs1`);
    expect(patchReq.request.method).toBe('PATCH');
    // La valeur recalculée à partir de l'historique doit remplacer l'ancien score stocké (10), pas le conserver.
    expect(patchReq.request.body.score).not.toBe(existing.score);
    patchReq.flush({ ...existing, ...patchReq.request.body });

    expect(result?.id).toBe('cs1');
  });
});
