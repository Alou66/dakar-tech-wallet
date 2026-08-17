import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { ClientLoanFormComponent } from './client-loan-form.component';
import { AuthService } from '../../../../core/services/auth.service';
import { environment } from '../../../../../environments/environment';
import { User, UserRole, UserStatus } from '../../../../core/models/user.model';

const API = environment.apiUrl;

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'u2',
    firstName: 'Fatou',
    lastName: 'Ndiaye',
    email: 'fatou.ndiaye@example.sn',
    phone: '+221771111111',
    accountNumber: 'ACC-0002',
    role: UserRole.CLIENT,
    status: UserStatus.ACTIVE,
    walletBalance: 65000,
    createdAt: '2026-01-10T10:00:00.000Z',
    updatedAt: '2026-01-10T10:00:00.000Z',
    ...overrides,
  };
}

describe('ClientLoanFormComponent', () => {
  let httpMock: HttpTestingController;
  let currentUser: User | null;

  function createComponent() {
    TestBed.configureTestingModule({
      imports: [ClientLoanFormComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: AuthService, useValue: { getCurrentUser: () => currentUser } },
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(ClientLoanFormComponent);
    fixture.detectChanges();
    return fixture;
  }

  function flushEligibility(status: UserStatus) {
    // Le contrôle `eligibility` est revalidé une seconde fois lorsque la
    // directive `[formGroup]` se raccroche au FormGroup construit en amont
    // (`_updateTreeValidity`) : la première requête est alors annulée, seule
    // la plus récente reste active et doit être flushée.
    const requests = httpMock.match(`${API}/users/${currentUser!.id}`);
    const live = requests.filter((req) => !req.cancelled);
    live[live.length - 1].flush(makeUser({ status }));
  }

  function fillValidFields(component: ClientLoanFormComponent) {
    component.form.patchValue({ amount: 100000, purpose: 'Achat matériel', durationMonths: 6 });
  }

  afterEach(() => httpMock.verify());

  it('conserve les validations synchrones existantes (montant, motif, durée)', () => {
    currentUser = makeUser();
    const fixture = createComponent();
    const { form } = fixture.componentInstance;

    expect(form.get('amount')?.hasError('required')).toBe(true);
    form.get('amount')?.setValue(-5);
    expect(form.get('amount')?.hasError('min')).toBe(true);

    form.get('purpose')?.setValue('ab');
    expect(form.get('purpose')?.hasError('minlength')).toBe(true);

    form.get('durationMonths')?.setValue(120);
    expect(form.get('durationMonths')?.hasError('max')).toBe(true);

    flushEligibility(UserStatus.ACTIVE);
  });

  it("place le contrôle d'éligibilité en PENDING pendant la vérification serveur et bloque canSubmit", () => {
    currentUser = makeUser();
    const fixture = createComponent();
    const component = fixture.componentInstance;
    fillValidFields(component);

    expect(component.form.get('eligibility')?.status).toBe('PENDING');
    expect(component.checkingEligibility()).toBe(true);
    expect(component.canSubmit()).toBe(false);

    flushEligibility(UserStatus.ACTIVE);
  });

  it('ne soumet rien tant que la validation asynchrone est en cours (PENDING)', () => {
    currentUser = makeUser();
    const fixture = createComponent();
    const component = fixture.componentInstance;
    fillValidFields(component);

    component.submit();

    httpMock.expectNone((req) => req.method === 'POST' && req.url === `${API}/loans`);

    flushEligibility(UserStatus.ACTIVE);
  });

  it('valide de façon asynchrone un client actif et autorise la soumission une fois le reste du formulaire valide', () => {
    currentUser = makeUser({ status: UserStatus.ACTIVE });
    const fixture = createComponent();
    const component = fixture.componentInstance;
    fillValidFields(component);

    flushEligibility(UserStatus.ACTIVE);

    expect(component.form.get('eligibility')?.valid).toBe(true);
    expect(component.canSubmit()).toBe(true);
  });

  it('rejette la validation asynchrone pour un compte suspendu et affiche une erreur claire', () => {
    currentUser = makeUser({ status: UserStatus.SUSPENDED });
    const fixture = createComponent();
    const component = fixture.componentInstance;
    fillValidFields(component);

    flushEligibility(UserStatus.SUSPENDED);

    expect(component.form.get('eligibility')?.hasError('accountSuspended')).toBe(true);
    expect(component.canSubmit()).toBe(false);
    expect(component.eligibilityErrorMessage()).toBe(
      'Votre compte est suspendu. Vous ne pouvez plus demander de prêt.',
    );
  });

  it('empêche la soumission après un échec de validation asynchrone (compte suspendu)', () => {
    currentUser = makeUser({ status: UserStatus.SUSPENDED });
    const fixture = createComponent();
    const component = fixture.componentInstance;
    fillValidFields(component);

    flushEligibility(UserStatus.SUSPENDED);
    component.submit();

    httpMock.expectNone((req) => req.method === 'POST' && req.url === `${API}/loans`);
  });

  it('soumet la demande de prêt une fois toutes les validations (sync + async) réussies', () => {
    currentUser = makeUser({ status: UserStatus.ACTIVE });
    const fixture = createComponent();
    const component = fixture.componentInstance;
    fillValidFields(component);

    flushEligibility(UserStatus.ACTIVE);
    component.submit();

    // La soumission n'ouvre que la modale de confirmation : aucune requête
    // n'est envoyée tant que l'utilisateur n'a pas confirmé.
    expect(component.showConfirmModal()).toBe(true);
    httpMock.expectNone((r) => r.method === 'POST' && r.url === `${API}/loans`);

    component.onConfirmModalConfirm();

    const req = httpMock.expectOne((r) => r.method === 'POST' && r.url === `${API}/loans`);
    expect(req.request.body.userId).toBe(currentUser!.id);
    expect(req.request.body.amount).toBe(100000);
    req.flush({ id: 'loan99', ...req.request.body });

    expect(component.successMessage()).toBe('Votre demande de prêt a été envoyée avec succès.');
    expect(component.showConfirmModal()).toBe(false);
  });

  it('ferme la modale de confirmation sans rien envoyer quand on annule', () => {
    currentUser = makeUser({ status: UserStatus.ACTIVE });
    const fixture = createComponent();
    const component = fixture.componentInstance;
    fillValidFields(component);

    flushEligibility(UserStatus.ACTIVE);
    component.submit();
    expect(component.showConfirmModal()).toBe(true);

    component.onConfirmModalCancel();

    expect(component.showConfirmModal()).toBe(false);
    httpMock.expectNone((r) => r.method === 'POST' && r.url === `${API}/loans`);
  });
});
