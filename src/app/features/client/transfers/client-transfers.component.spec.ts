import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { ClientTransfersComponent } from './client-transfers.component';
import { AuthService } from '../../../core/services/auth.service';
import { environment } from '../../../../environments/environment';
import { User, UserRole, UserStatus } from '../../../core/models/user.model';

const API = environment.apiUrl;

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

function setup(userOverrides: Partial<User> = {}) {
  const user = makeUser(userOverrides);

  TestBed.configureTestingModule({
    imports: [ClientTransfersComponent],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: AuthService,
        useValue: { getCurrentUser: () => user, currentUser: () => user },
      },
    ],
  });

  const httpMock = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(ClientTransfersComponent);
  const component = fixture.componentInstance;
  fixture.detectChanges();

  httpMock.expectOne(`${API}/users/${user.id}`).flush(user);

  return { component, httpMock, user };
}

describe('ClientTransfersComponent - compte suspendu', () => {
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  it("empêche un client suspendu d'effectuer un virement", () => {
    const { component, httpMock } = setup({ status: UserStatus.SUSPENDED });

    expect(component.senderSuspended()).toBe(true);
    expect(component.canSubmit()).toBe(false);

    component.submit();

    httpMock.expectNone(`${API}/transactions`);
  });

  it('autorise un client actif à effectuer un virement (formulaire non bloqué)', () => {
    const { component } = setup({ status: UserStatus.ACTIVE });

    expect(component.senderSuspended()).toBe(false);
  });
});

describe('ClientTransfersComponent - confirmation du virement', () => {
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  function fillValidTransfer(component: ClientTransfersComponent, httpMock: HttpTestingController, beneficiary: User) {
    component.form.patchValue({ accountNumber: beneficiary.accountNumber, amount: 10000 });
    httpMock.expectOne((req) => req.url === `${API}/users` && req.params.get('accountNumber') === beneficiary.accountNumber)
      .flush([beneficiary]);
  }

  it("ouvre une confirmation avant d'envoyer le virement, sans appeler le service tant qu'elle n'est pas validée", () => {
    const { component, httpMock } = setup({ status: UserStatus.ACTIVE });
    const beneficiary = makeUser({ id: 'u2', accountNumber: 'ACC-0002' });
    fillValidTransfer(component, httpMock, beneficiary);

    component.submit();

    expect(component.showConfirmModal()).toBe(true);
    httpMock.expectNone(`${API}/transactions`);

    component.onConfirmModalCancel();
    expect(component.showConfirmModal()).toBe(false);
    httpMock.expectNone(`${API}/transactions`);
  });

  it('effectue le virement une fois la confirmation validée', () => {
    const { component, httpMock, user } = setup({ status: UserStatus.ACTIVE });
    const beneficiary = makeUser({ id: 'u2', accountNumber: 'ACC-0002', walletBalance: 5000 });
    fillValidTransfer(component, httpMock, beneficiary);

    component.submit();
    component.onConfirmModalConfirm();

    httpMock.expectOne(`${API}/users/${user.id}`).flush(user);
    httpMock.expectOne(`${API}/users/${beneficiary.id}`).flush(beneficiary);

    const txReq = httpMock.expectOne(`${API}/transactions`);
    expect(txReq.request.body.amount).toBe(10000);
    txReq.flush({ id: 'tx1', ...txReq.request.body });

    httpMock.expectOne(`${API}/users/${user.id}`).flush({ ...user, walletBalance: 90000 });
    httpMock.expectOne(`${API}/users/${beneficiary.id}`).flush({ ...beneficiary, walletBalance: 15000 });

    expect(component.successMessage()).toBe('Virement effectué avec succès.');
    expect(component.showConfirmModal()).toBe(false);
  });
});
