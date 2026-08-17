import { Component, signal, computed, inject, OnInit } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
import { Observable, forkJoin, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { UserService } from '../../../core/services/user.service';
import { TransactionService } from '../../../core/services/transaction.service';
import { AuthService } from '../../../core/services/auth.service';
import { User, UserStatus } from '../../../core/models/user.model';
import { Transaction, TransactionType, TransactionStatus } from '../../../core/models/transaction.model';
import {
  ConfirmationDetail,
  ConfirmationModalComponent,
} from '../../../shared/components/confirmation-modal/confirmation-modal.component';

@Component({
  selector: 'app-client-transfers',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ConfirmationModalComponent],
  templateUrl: './client-transfers.component.html',
  styleUrl: './client-transfers.component.css'
})
export class ClientTransfersComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly userService = inject(UserService);
  private readonly transactionService = inject(TransactionService);
  private readonly authService = inject(AuthService);

  private readonly currentUserSignal = signal<User | null>(this.authService.getCurrentUser());
  readonly currentUser = this.currentUserSignal.asReadonly();

  readonly form: FormGroup = this.fb.group({
    accountNumber: ['', {
      validators: [Validators.required, Validators.minLength(1)],
      asyncValidators: [this.accountNumberAsyncValidator.bind(this)],
      updateOn: 'blur'
    }],
    amount: ['', [Validators.required, Validators.min(1)]],
    description: [''],
  });

  readonly beneficiary = signal<User | null>(null);
  readonly beneficiaryLookup = signal<boolean>(false);
  readonly beneficiaryError = signal<string | null>(null);

  readonly submitting = signal(false);
  readonly successMessage = signal<string | null>(null);
  readonly errorMessage = signal<string | null>(null);

  readonly showConfirmModal = signal(false);

  readonly availableBalance = computed(() => this.currentUser()?.walletBalance ?? 0);

  readonly confirmModalDetails = computed<ConfirmationDetail[]>(() => {
    this.formValueSignal();
    const beneficiary = this.beneficiary();
    const amount = Number(this.form.get('amount')?.value) || 0;

    return [
      {
        label: 'Bénéficiaire',
        value: beneficiary
          ? `${beneficiary.firstName} ${beneficiary.lastName} (${beneficiary.accountNumber})`
          : '—',
      },
      { label: 'Montant', value: `${this.formatBalance(amount)} FCFA` },
    ];
  });

  /** Un compte suspendu ne peut plus initier de virement (re-vérifié à chaque chargement du profil). */
  readonly senderSuspended = computed(() => this.currentUser()?.status === UserStatus.SUSPENDED);

  /**
   * Les changements de valeur/statut du formulaire ne sont pas des Signals :
   * on les relaie ici pour que `canSubmit` se recalcule à chaque saisie
   * (montant) et à chaque changement de validité (ex: validation asynchrone
   * du bénéficiaire). Deux Signals distincts sont nécessaires : fusionner les
   * deux flux en un seul ferait perdre les changements de valeur lorsque le
   * statut ne change pas (ex: VALID -> VALID) puisque `Object.is` les jugerait
   * alors identiques.
   */
  private readonly formValueSignal = toSignal(this.form.valueChanges, { initialValue: this.form.value });
  private readonly formStatusSignal = toSignal(this.form.statusChanges, { initialValue: this.form.status });

  readonly canSubmit = computed(() => {
    this.formValueSignal();
    this.formStatusSignal();

    const user = this.currentUser();
    const beneficiary = this.beneficiary();
    if (
      !user ||
      this.senderSuspended() ||
      this.submitting() ||
      this.form.invalid ||
      this.beneficiaryError() ||
      !beneficiary
    ) {
      return false;
    }

    const amount = Number(this.form.get('amount')?.value);
    return beneficiary.id !== user.id && amount > 0 && amount <= user.walletBalance;
  });

  ngOnInit(): void {
    const user = this.authService.getCurrentUser();
    if (!user) {
      this.errorMessage.set('Utilisateur non connecté.');
      return;
    }

    this.userService.getById(user.id).subscribe({
      next: (freshUser) => {
        this.currentUserSignal.set(freshUser);
      },
      error: () => {
        this.errorMessage.set('Impossible de charger le profil utilisateur.');
      },
    });
  }

  private accountNumberAsyncValidator(control: AbstractControl): Observable<ValidationErrors | null> {
    const value = control.value;
    if (!value || value.trim().length === 0) {
      this.beneficiary.set(null);
      this.beneficiaryError.set(null);
      this.beneficiaryLookup.set(false);
      return of(null);
    }

    this.beneficiaryLookup.set(true);
    this.beneficiaryError.set(null);

    return this.userService.searchByAccountNumber(value).pipe(
      map((users: User[]) => {
        this.beneficiaryLookup.set(false);
        if (users.length === 0) {
          this.beneficiary.set(null);
          this.beneficiaryError.set('Aucun compte trouvé pour ce numéro.');
          return { accountNotFound: true };
        }
        const found = users[0];
        if (found.status === UserStatus.SUSPENDED) {
          this.beneficiary.set(found);
          this.beneficiaryError.set('Ce compte est suspendu.');
          return { accountSuspended: true };
        }
        this.beneficiary.set(found);
        this.beneficiaryError.set(null);
        return null;
      }),
      catchError(() => {
        this.beneficiaryLookup.set(false);
        this.beneficiary.set(null);
        this.beneficiaryError.set('Erreur lors de la recherche du compte.');
        return of({ accountLookupError: true });
      })
    );
  }

  submit(): void {
    if (this.canSubmit() === false) return;
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

    const user = this.currentUser();
    const beneficiary = this.beneficiary();
    const amount = this.form.get('amount')?.value;
    const description = this.form.get('description')?.value;

    if (!user || !beneficiary || !amount) {
      this.showConfirmModal.set(false);
      return;
    }

    this.submitting.set(true);
    this.successMessage.set(null);
    this.errorMessage.set(null);

    // JSON Server ne garantit aucune atomicité entre requêtes : on relit le
    // solde de l'expéditeur et du bénéficiaire côté serveur juste avant de
    // débiter/créditer, pour ne jamais écraser un solde avec une valeur
    // calculée à partir d'un cache pouvant être périmé (même principe que
    // les relectures fraîches de `ClientLoanDetailComponent` /
    // `AdminLoansComponent`).
    forkJoin({
      freshSender: this.userService.getById(user.id),
      freshBeneficiary: this.userService.getById(beneficiary.id),
    }).subscribe({
      next: ({ freshSender, freshBeneficiary }) => {
        if (freshSender.status === UserStatus.SUSPENDED) {
          this.errorMessage.set('Votre compte est suspendu. Vous ne pouvez plus effectuer de virement.');
          this.submitting.set(false);
          this.showConfirmModal.set(false);
          return;
        }
        if (freshBeneficiary.status === UserStatus.SUSPENDED) {
          this.errorMessage.set('Le compte du bénéficiaire est suspendu.');
          this.submitting.set(false);
          this.showConfirmModal.set(false);
          return;
        }
        if (amount > freshSender.walletBalance) {
          this.errorMessage.set('Solde insuffisant pour effectuer ce virement.');
          this.submitting.set(false);
          this.showConfirmModal.set(false);
          return;
        }

        const transaction: Omit<Transaction, 'id' | 'createdAt'> = {
          type: TransactionType.VIREMENT,
          status: TransactionStatus.REUSSIE,
          amount,
          senderId: freshSender.id,
          receiverId: freshBeneficiary.id,
          description: description || undefined,
        };

        this.transactionService.create(transaction).subscribe({
          next: (createdTransaction) => {
            const newSenderBalance = freshSender.walletBalance - amount;
            const newReceiverBalance = freshBeneficiary.walletBalance + amount;

            forkJoin({
              sender: this.userService.update(freshSender.id, { walletBalance: newSenderBalance }),
              receiver: this.userService.update(freshBeneficiary.id, { walletBalance: newReceiverBalance }),
            }).subscribe({
              next: ({ sender }) => {
                this.currentUserSignal.set(sender);
                this.successMessage.set('Virement effectué avec succès.');
                this.form.reset();
                this.beneficiary.set(null);
                this.beneficiaryError.set(null);
                this.submitting.set(false);
                this.showConfirmModal.set(false);
              },
              error: () => {
                // La transaction est déjà enregistrée en REUSSIE mais les
                // soldes n'ont pas pu être mis à jour : on corrige son statut
                // pour ne pas laisser un enregistrement "réussi" alors
                // qu'aucun montant n'a réellement été transféré.
                this.transactionService
                  .update(createdTransaction.id, { status: TransactionStatus.ECHOUEE })
                  .subscribe();
                this.errorMessage.set('Virement créé, mais la mise à jour des soldes a échoué.');
                this.submitting.set(false);
                this.showConfirmModal.set(false);
              },
            });
          },
          error: () => {
            this.errorMessage.set('Impossible d\'effectuer le virement. Veuillez réessayer.');
            this.submitting.set(false);
            this.showConfirmModal.set(false);
          },
        });
      },
      error: () => {
        this.errorMessage.set('Impossible de vérifier les comptes avant le virement. Veuillez réessayer.');
        this.submitting.set(false);
        this.showConfirmModal.set(false);
      },
    });
  }

  formatBalance(value: number): string {
    return new Intl.NumberFormat('fr-FR').format(value);
  }
}
