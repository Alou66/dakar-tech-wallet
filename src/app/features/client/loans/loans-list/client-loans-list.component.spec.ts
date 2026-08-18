import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { ClientLoansListComponent } from './client-loans-list.component';
import { AuthService } from '../../../../core/services/auth.service';
import { environment } from '../../../../../environments/environment';
import { Loan, LoanStatus } from '../../../../core/models/loan.model';
import { CreditScore, CreditScoreCategory } from '../../../../core/models/credit-score.model';
import { User, UserRole, UserStatus } from '../../../../core/models/user.model';

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

function makeCreditScore(overrides: Partial<CreditScore> = {}): CreditScore {
  return {
    id: 'cs1',
    userId: USER_ID,
    score: 68,
    category: CreditScoreCategory.BON,
    totalLoans: 1,
    onTimeRepayments: 1,
    lateRepayments: 1,
    calculatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function setupModule(userOverrides: Partial<User> = {}) {
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

  return { component, httpMock, user };
}

function flushLoad(httpMock: HttpTestingController, user: User, loans: Loan[], creditScore: CreditScore | null) {
  httpMock.expectOne(`${API}/loans/user/${user.id}`).flush(loans);

  const scoreReq = httpMock.expectOne(`${API}/credit-scores/user/${user.id}`);
  if (creditScore) {
    scoreReq.flush(creditScore);
  } else {
    scoreReq.flush('Aucun score', { status: 404, statusText: 'Not Found' });
  }

  httpMock.expectOne(`${API}/users/${user.id}`).flush(user);
}

describe('ClientLoansListComponent', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('charge les prêts et le score de solvabilité tels que renvoyés par le serveur', () => {
    const { component, httpMock, user } = setupModule();
    const loan = makeLoan();
    const creditScore = makeCreditScore({ score: 72, onTimeRepayments: 3, lateRepayments: 1 });

    flushLoad(httpMock, user, [loan], creditScore);

    expect(component.sortedLoans().length).toBe(1);
    expect(component.creditScore()?.score).toBe(72);
    expect(component.creditScore()?.onTimeRepayments).toBe(3);
    expect(component.creditScore()?.lateRepayments).toBe(1);
  });

  it("n'affiche aucun score quand le client n'en a pas encore (jamais eu de prêt) : le 404 est traité comme une absence, pas une erreur", () => {
    const { component, httpMock, user } = setupModule();

    flushLoad(httpMock, user, [], null);

    expect(component.creditScore()).toBeUndefined();
    expect(component.error()).toBeNull();
  });

  it('détecte un compte suspendu et le reflète dans le signal accountSuspended', () => {
    const { component, httpMock, user } = setupModule({ status: UserStatus.SUSPENDED });

    flushLoad(httpMock, user, [makeLoan()], null);

    expect(component.accountSuspended()).toBe(true);
  });

  it('trie les prêts du plus récent au plus ancien', () => {
    const { component, httpMock, user } = setupModule();
    const older = makeLoan({ id: 'loan-old', requestDate: '2026-01-01T00:00:00.000Z' });
    const newer = makeLoan({ id: 'loan-new', requestDate: '2026-06-01T00:00:00.000Z' });

    flushLoad(httpMock, user, [older, newer], null);

    expect(component.sortedLoans().map((l) => l.id)).toEqual(['loan-new', 'loan-old']);
  });

  it('affiche une erreur et permet de réessayer si le chargement des prêts échoue', () => {
    const { component, httpMock, user } = setupModule();

    // `forkJoin` annule automatiquement la requête credit-scores encore en
    // vol dès que loans échoue : inutile de la flusher.
    httpMock.expectOne(`${API}/loans/user/${user.id}`).flush('Erreur', { status: 500, statusText: 'Server Error' });
    httpMock.expectOne(`${API}/users/${user.id}`).flush(user);

    expect(component.error()).toBe('Impossible de charger vos prêts.');
    expect(component.loading()).toBe(false);

    // `retry()` ne relance que `loadLoans` (loans + score), pas la
    // vérification de suspension déclenchée une seule fois à l'initialisation.
    // `match()` + filtre `cancelled` reste robuste face à la requête
    // credit-scores déjà annulée par le `forkJoin` du premier essai.
    component.retry();
    httpMock.expectOne(`${API}/loans/user/${user.id}`).flush([makeLoan()]);
    httpMock
      .match(`${API}/credit-scores/user/${user.id}`)
      .filter((req) => !req.cancelled)[0]
      .flush('Aucun score', { status: 404, statusText: 'Not Found' });

    expect(component.error()).toBeNull();
    expect(component.sortedLoans().length).toBe(1);
  });
});
