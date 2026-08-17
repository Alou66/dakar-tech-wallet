import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import {
  AbstractControl,
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Observable, catchError, map, of } from 'rxjs';

import { LoanService } from '../../../../core/services/loan.service';
import { AuthService } from '../../../../core/services/auth.service';
import { UserService } from '../../../../core/services/user.service';
import { Loan, LoanStatus } from '../../../../core/models/loan.model';
import { formatCurrency, isEligibleForLoanRequest } from '../../../../core/utils/loan-display.util';
import { scheduleTotalDue } from '../../../../core/utils/loan-schedule.util';
import {
  ConfirmationDetail,
  ConfirmationModalComponent,
} from '../../../../shared/components/confirmation-modal/confirmation-modal.component';

const DEFAULT_INTEREST_RATE = 5;

@Component({
  selector: 'app-client-loan-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, ConfirmationModalComponent],
  templateUrl: './client-loan-form.component.html',
  styleUrl: './client-loan-form.component.css',
})
export class ClientLoanFormComponent {
  private readonly fb = inject(FormBuilder);
  private readonly loanService = inject(LoanService);
  private readonly authService = inject(AuthService);
  private readonly userService = inject(UserService);

  readonly formatCurrency = formatCurrency;
  readonly interestRate = DEFAULT_INTEREST_RATE;

  readonly submitting = signal(false);
  readonly successMessage = signal<string | null>(null);
  readonly errorMessage = signal<string | null>(null);

  readonly showConfirmModal = signal(false);

  /**
   * État de la validation asynchrone d'éligibilité, tenu à jour en Signals
   * directement depuis le pipeline RxJS du validateur (et non depuis
   * `statusChanges` du contrôle) : Angular revalide une seconde fois tout
   * l'arbre du formulaire au moment où la directive `[formGroup]` s'y
   * raccroche (`emitEvent: false`), ce qui rend `statusChanges` muet pour la
   * toute première résolution. Ce sont ces Signals, pas le statut du
   * contrôle, qui pilotent l'UI — même principe que `beneficiary`/
   * `beneficiaryError` dans `ClientTransfersComponent`.
   */
  readonly checkingEligibility = signal(true);
  readonly eligibilityErrorMessage = signal<string | null>(null);
  private readonly eligible = signal(false);

  /**
   * `eligibility` ne correspond à aucun champ saisi par l'utilisateur : c'est
   * un contrôle dédié qui ne porte que la validation asynchrone "ce client
   * peut-il actuellement demander un prêt ?" (compte non suspendu, revérifié
   * côté serveur). Elle est ainsi déclenchée une seule fois, à la
   * construction du formulaire, sans se redéclencher à chaque frappe dans
   * les autres champs (montant, motif, durée).
   */
  readonly form: FormGroup = this.fb.group({
    amount: ['', [Validators.required, Validators.min(1)]],
    purpose: ['', [Validators.required, Validators.minLength(3)]],
    durationMonths: ['', [Validators.required, Validators.min(1), Validators.max(60)]],
    eligibility: [true, { asyncValidators: [this.eligibilityAsyncValidator.bind(this)] }],
  });

  private readonly formValue = toSignal(this.form.valueChanges, { initialValue: this.form.value });
  private readonly formStatus = toSignal(this.form.statusChanges, { initialValue: this.form.status });

  readonly canSubmit = computed(() => {
    this.formStatus();
    return (
      !this.submitting() &&
      !this.checkingEligibility() &&
      this.eligible() &&
      this.form.get('amount')!.valid &&
      this.form.get('purpose')!.valid &&
      this.form.get('durationMonths')!.valid
    );
  });

  /** Simulation en direct de la mensualité, tant que le montant et la durée saisis sont valides. */
  readonly simulation = computed(() => {
    this.formValue();
    const amount = Number(this.form.get('amount')?.value);
    const durationMonths = Number(this.form.get('durationMonths')?.value);
    if (!(amount > 0) || !(durationMonths > 0)) {
      return null;
    }

    const monthlyPayment = Math.round((amount + (amount * this.interestRate) / 100) / durationMonths);
    const totalDue = scheduleTotalDue({ monthlyPayment, durationMonths });
    return { monthlyPayment, totalDue };
  });

  readonly confirmModalDetails = computed<ConfirmationDetail[]>(() => {
    this.formValue();
    const amount = Number(this.form.get('amount')?.value) || 0;
    const durationMonths = Number(this.form.get('durationMonths')?.value) || 0;

    const details: ConfirmationDetail[] = [
      { label: 'Montant demandé', value: this.formatCurrency(amount) },
      { label: 'Durée', value: `${durationMonths} mois` },
    ];

    const sim = this.simulation();
    if (sim) {
      details.push({ label: 'Mensualité estimée', value: this.formatCurrency(sim.monthlyPayment) });
      details.push({ label: 'Total à rembourser', value: this.formatCurrency(sim.totalDue) });
    }

    return details;
  });

  /**
   * Vérifie côté serveur, via `UserService`, que le client peut actuellement
   * demander un prêt (seule règle réellement en vigueur dans le projet :
   * `isEligibleForLoanRequest`, càd un compte non suspendu). Ne dépend pas de
   * la valeur du contrôle : c'est le client connecté qui est revérifié.
   */
  private eligibilityAsyncValidator(_control: AbstractControl): Observable<ValidationErrors | null> {
    const user = this.authService.getCurrentUser();
    if (!user) {
      this.checkingEligibility.set(false);
      this.eligible.set(false);
      this.eligibilityErrorMessage.set('Utilisateur non connecté.');
      return of({ notAuthenticated: true });
    }

    this.checkingEligibility.set(true);

    return this.userService.getById(user.id).pipe(
      map((freshUser) => {
        this.checkingEligibility.set(false);
        if (isEligibleForLoanRequest(freshUser)) {
          this.eligible.set(true);
          this.eligibilityErrorMessage.set(null);
          return null;
        }
        this.eligible.set(false);
        this.eligibilityErrorMessage.set('Votre compte est suspendu. Vous ne pouvez plus demander de prêt.');
        return { accountSuspended: true };
      }),
      catchError(() => {
        this.checkingEligibility.set(false);
        this.eligible.set(false);
        this.eligibilityErrorMessage.set(
          'Impossible de vérifier votre éligibilité pour le moment. Veuillez réessayer.',
        );
        return of({ eligibilityCheckFailed: true });
      }),
    );
  }

  submit(): void {
    if (this.canSubmit() === false) {
      this.form.markAllAsTouched();
      return;
    }

    this.showConfirmModal.set(true);
  }

  onConfirmModalCancel(): void {
    this.showConfirmModal.set(false);
  }

  onConfirmModalConfirm(): void {
    this.confirmedSubmit();
  }

  private confirmedSubmit(): void {
    if (this.submitting()) return;

    const user = this.authService.getCurrentUser();
    if (!user) {
      this.errorMessage.set('Utilisateur non connecté.');
      this.showConfirmModal.set(false);
      return;
    }

    const amount = Number(this.form.get('amount')?.value);
    const purpose = String(this.form.get('purpose')?.value).trim();
    const durationMonths = Number(this.form.get('durationMonths')?.value);
    const monthlyPayment = Math.round((amount + (amount * DEFAULT_INTEREST_RATE) / 100) / durationMonths);

    const loan: Omit<Loan, 'id'> = {
      userId: user.id,
      amount,
      interestRate: DEFAULT_INTEREST_RATE,
      durationMonths,
      monthlyPayment,
      // Total réellement dû (capital + intérêts), cohérent avec l'échéancier
      // généré à l'approbation (voir `scheduleTotalDue` / `generateInstallments`).
      remainingBalance: scheduleTotalDue({ monthlyPayment, durationMonths }),
      status: LoanStatus.EN_ATTENTE,
      purpose,
      requestDate: new Date().toISOString(),
    };

    this.submitting.set(true);
    this.successMessage.set(null);
    this.errorMessage.set(null);

    this.loanService.create(loan).subscribe({
      next: () => {
        this.successMessage.set('Votre demande de prêt a été envoyée avec succès.');
        // Ne réinitialise que les champs saisis : `eligibility` ne porte
        // aucune valeur utilisateur, la retoucher ne ferait que déclencher
        // un nouveau contrôle serveur inutile (le succès n'est de toute
        // façon plus affiché avec le formulaire, voir le template).
        this.form.patchValue({ amount: null, purpose: null, durationMonths: null });
        this.submitting.set(false);
        this.showConfirmModal.set(false);
      },
      error: () => {
        this.errorMessage.set("Impossible d'envoyer la demande de prêt. Veuillez réessayer.");
        this.submitting.set(false);
        this.showConfirmModal.set(false);
      },
    });
  }
}
