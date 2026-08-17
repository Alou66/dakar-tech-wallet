import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { AdminDashboardComponent } from './admin-dashboard.component';
import { environment } from '../../../../environments/environment';
import { Loan, LoanStatus } from '../../../core/models/loan.model';
import { User, UserRole, UserStatus } from '../../../core/models/user.model';

const API = environment.apiUrl;

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'u1',
    firstName: 'Fatou',
    lastName: 'Ndiaye',
    email: 'fatou@example.sn',
    phone: '+221770000000',
    accountNumber: 'ACC-0001',
    role: UserRole.CLIENT,
    status: UserStatus.ACTIVE,
    walletBalance: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeLoan(overrides: Partial<Loan> = {}): Loan {
  return {
    id: 'loan1',
    userId: 'u1',
    amount: 100000,
    interestRate: 5,
    durationMonths: 4,
    monthlyPayment: 26250,
    remainingBalance: 52500,
    status: LoanStatus.EN_COURS,
    requestDate: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function setup() {
  TestBed.configureTestingModule({
    imports: [AdminDashboardComponent],
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });

  const httpMock = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(AdminDashboardComponent);
  const component = fixture.componentInstance;
  fixture.detectChanges();

  return { component, httpMock, fixture };
}

describe('AdminDashboardComponent - comptage des prêts en retard', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it("3. compte un prêt EN_RETARD dans les statistiques du tableau de bord Admin, une fois son statut réellement persisté", () => {
    const loans = [
      makeLoan({ id: 'loan1', status: LoanStatus.EN_COURS }),
      makeLoan({ id: 'loan4', status: LoanStatus.EN_RETARD }),
      makeLoan({ id: 'loan6', status: LoanStatus.REMBOURSE, remainingBalance: 0 }),
    ];
    const { component, httpMock, fixture } = setup();

    httpMock.expectOne(`${API}/users`).flush([makeUser()]);
    httpMock.expectOne(`${API}/loans`).flush(loans);
    httpMock.expectOne(`${API}/transactions`).flush([]);
    fixture.detectChanges();

    expect(component.stats()?.lateLoans).toBe(1);
    expect(component.stats()?.ongoingLoans).toBe(1);
    expect(component.stats()?.repaidLoans).toBe(1);

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('prêt(s) en retard de remboursement');
  });

  it("ne compte aucun prêt en retard tant qu'aucun n'a le statut EN_RETARD", () => {
    const loans = [makeLoan({ id: 'loan1', status: LoanStatus.EN_COURS })];
    const { component, httpMock } = setup();

    httpMock.expectOne(`${API}/users`).flush([makeUser()]);
    httpMock.expectOne(`${API}/loans`).flush(loans);
    httpMock.expectOne(`${API}/transactions`).flush([]);

    expect(component.stats()?.lateLoans).toBe(0);
  });
});
