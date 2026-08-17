import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  AbstractControl,
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { Observable, catchError, forkJoin, map, of } from 'rxjs';

import { LoanService } from '../../../../core/services/loan.service';
import { RepaymentService } from '../../../../core/services/repayment.service';
import { TransactionService } from '../../../../core/services/transaction.service';
import { UserService } from '../../../../core/services/user.service';
import { AuthService } from '../../../../core/services/auth.service';
import { Loan, LoanStatus } from '../../../../core/models/loan.model';
import { UserStatus } from '../../../../core/models/user.model';
import { Repayment, RepaymentStatus } from '../../../../core/models/repayment.model';
import { Transaction, TransactionStatus, TransactionType } from '../../../../core/models/transaction.model';
import {
  daysLateForRepayment,
  formatCurrency,
  formatDate,
  isLateRepayment,
  isRepayableLoan,
  loanStatusClass,
  loanStatusLabel,
  repaymentStatusClass,
  repaymentStatusLabel,
} from '../../../../core/utils/loan-display.util';
import { deriveLoanStatus } from '../../../../core/utils/loan-status.util';
import {
  ConfirmationDetail,
  ConfirmationModalComponent,
} from '../../../../shared/components/confirmation-modal/confirmation-modal.component';

type PendingRepaymentAction = 'installment' | 'total' | null;

@Component({
  selector: 'app-client-loan-detail',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, ConfirmationModalComponent],
  templateUrl: './client-loan-detail.component.html',
  styleUrl: './client-loan-detail.component.css',
})
export class ClientLoanDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly fb = inject(FormBuilder);
  private readonly loanService = inject(LoanService);
  private readonly repaymentService = inject(RepaymentService);
  private readonly transactionService = inject(TransactionService);
  private readonly userService = inject(UserService);
  private readonly authService = inject(AuthService);

  readonly walletBalance = signal<number>(0);
  /** Vérifié à chaque chargement du profil : un compte suspendu ne peut plus rembourser. */
  readonly accountSuspended = signal(false);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly loan = signal<Loan | null>(null);
  readonly repayments = signal<Repayment[]>([]);
  readonly scheduleExpanded = signal(false);

  readonly sortedSchedule = computed(() =>
    [...this.repayments()].sort((a, b) => a.installmentNumber - b.installmentNumber),
  );

  readonly payableInstallments = computed(() =>
    this.repayments().filter(
      (installment) =>
        installment.status === RepaymentStatus.PLANIFIE ||
        installment.status === RepaymentStatus.EN_RETARD ||
        installment.status === RepaymentStatus.IMPAYE,
    ),
  );

  /**
   * `repaymentId` porte à la fois la validation synchrone (une échéance doit
   * être sélectionnée) et la validation asynchrone : dès qu'une échéance est
   * choisie, on revérifie côté serveur (via `LoanService`, `RepaymentService`
   * et `UserService`) que le prêt appartient bien au client, qu'il est
   * réellement remboursable, que l'échéance est encore payable et que le
   * solde du portefeuille suffit. Ce contrôle asynchrone donne un retour
   * immédiat dans le formulaire ; la relecture fraîche juste avant le débit
   * dans `payInstallment()` reste l'ultime garde-fou (protection contre les
   * conditions de course, non dupliquée ici).
   */
  readonly repaymentForm: FormGroup = this.fb.group({
    repaymentId: [
      '',
      {
        validators: [Validators.required],
        asyncValidators: [this.repaymentAsyncValidator.bind(this)],
      },
    ],
  });

  private readonly repaymentFormValue = toSignal(this.repaymentForm.valueChanges, {
    initialValue: this.repaymentForm.value,
  });

  private readonly repaymentFormStatus = toSignal(this.repaymentForm.statusChanges, {
    initialValue: this.repaymentForm.status,
  });

  readonly checkingRepayment = computed(() => {
    this.repaymentFormStatus();
    return this.repaymentForm.get('repaymentId')?.status === 'PENDING';
  });

  readonly repaymentCheckErrorMessage = computed(() => {
    this.repaymentFormStatus();
    const errors = this.repaymentForm.get('repaymentId')?.errors;
    if (!errors) return null;
    if (errors['loanNotOwned']) return 'Ce prêt ne vous appartient pas.';
    if (errors['loanNotRepayable']) return "Ce prêt n'est plus éligible au remboursement.";
    if (errors['installmentNotPayable']) return "Cette mensualité n'est plus payable.";
    if (errors['insufficientBalance']) return 'Solde insuffisant pour payer cette mensualité.';
    if (errors['required']) return null;
    return 'Impossible de vérifier cette mensualité pour le moment. Veuillez réessayer.';
  });

  readonly repaymentSubmitting = signal(false);
  readonly repaymentSuccessMessage = signal<string | null>(null);
  readonly repaymentErrorMessage = signal<string | null>(null);

  readonly pendingAction = signal<PendingRepaymentAction>(null);

  readonly confirmModalConfig = computed(() => {
    const action = this.pendingAction();
    if (action === 'installment') {
      const installment = this.selectedInstallment();
      const details: ConfirmationDetail[] = [
        {
          label: 'Mensualité',
          value: installment ? `N°${installment.installmentNumber}` : '—',
        },
        { label: 'Montant à payer', value: this.formatCurrency(this.selectedInstallmentAmount()) },
      ];
      if (installment) {
        details.push({ label: 'Échéance', value: this.formatDate(installment.dueDate) });
      }
      return {
        title: 'Confirmer le paiement de la mensualité',
        message: 'Vérifiez les informations avant de payer cette mensualité.',
        confirmLabel: 'Payer cette mensualité',
        details,
      };
    }
    if (action === 'total') {
      const loan = this.loan();
      const details: ConfirmationDetail[] = [
        { label: 'Montant total à rembourser', value: this.formatCurrency(loan?.remainingBalance ?? 0) },
      ];
      return {
        title: 'Confirmer le remboursement total',
        message: 'Vérifiez le montant avant de rembourser ce prêt en totalité.',
        confirmLabel: 'Rembourser le solde total',
        details,
      };
    }
    return {
      title: '',
      message: null as string | null,
      confirmLabel: 'Confirmer',
      details: [] as ConfirmationDetail[],
    };
  });

  readonly selectedInstallment = computed(() => {
    this.repaymentFormValue();
    const id = this.repaymentForm.get('repaymentId')?.value;
    if (!id) return null;
    return this.payableInstallments().find((installment) => installment.id === id) ?? null;
  });

  readonly selectedInstallmentAmount = computed(() => {
    const installment = this.selectedInstallment();
    if (!installment) return 0;
    return installment.amountDue + (installment.lateFee ?? 0);
  });

  readonly canPayInstallment = computed(() => {
    this.repaymentFormStatus();
    const loan = this.loan();
    const installment = this.selectedInstallment();
    if (
      !loan ||
      !installment ||
      this.accountSuspended() ||
      this.repaymentSubmitting() ||
      !isRepayableLoan(loan) ||
      !this.repaymentForm.valid
    ) {
      return false;
    }
    const amount = this.selectedInstallmentAmount();
    return amount > 0 && amount <= this.walletBalance();
  });

  readonly canPayTotal = computed(() => {
    const loan = this.loan();
    if (!loan || this.accountSuspended() || this.repaymentSubmitting() || !isRepayableLoan(loan)) {
      return false;
    }
    return loan.remainingBalance > 0 && loan.remainingBalance <= this.walletBalance();
  });

  ngOnInit(): void {
    const user = this.authService.getCurrentUser();
    if (!user) {
      this.error.set('Utilisateur non connecté.');
      this.loading.set(false);
      return;
    }

    const loanId = this.route.snapshot.paramMap.get('id');
    if (!loanId) {
      this.error.set('Prêt introuvable.');
      this.loading.set(false);
      return;
    }

    this.walletBalance.set(user.walletBalance);
    this.loadLoan(loanId, user.id);

    this.userService.getById(user.id).subscribe({
      next: (freshUser) => {
        this.walletBalance.set(freshUser.walletBalance);
        this.accountSuspended.set(freshUser.status === UserStatus.SUSPENDED);
      },
    });
  }

  retry(): void {
    const user = this.authService.getCurrentUser();
    const loanId = this.route.snapshot.paramMap.get('id');
    if (!user || !loanId) return;
    this.loadLoan(loanId, user.id);
  }

  private loadLoan(loanId: string, userId: string): void {
    this.loading.set(true);
    this.error.set(null);

    forkJoin({
      loan: this.loanService.getById(loanId),
      repayments: this.repaymentService.getByLoan(loanId),
    }).subscribe({
      next: ({ loan, repayments }) => {
        if (loan.userId !== userId) {
          this.error.set('Prêt introuvable.');
          this.loading.set(false);
          return;
        }
        this.loan.set(loan);
        this.repayments.set(repayments);
        this.loading.set(false);
        this.syncOverdueStatuses(repayments);
      },
      error: () => {
        this.error.set('Impossible de charger ce prêt.');
        this.loading.set(false);
      },
    });
  }

  /**
   * Reclasse EN_RETARD les échéances de ce prêt dont la date est dépassée,
   * puis aligne le statut du prêt sur l'échéancier à jour (voir
   * `LoanService.syncStatusFromRepayments`).
   */
  private syncOverdueStatuses(repayments: Repayment[]): void {
    this.repaymentService.syncOverdueStatuses(repayments).subscribe({
      next: (updated) => {
        this.repayments.set(updated);

        const loan = this.loan();
        if (loan) {
          this.loanService.syncStatusFromRepayments(loan, updated).subscribe({
            next: (updatedLoan) => this.loan.set(updatedLoan),
          });
        }
      },
    });
  }

  toggleSchedule(): void {
    this.scheduleExpanded.update((expanded) => !expanded);
  }

  /**
   * Validateur asynchrone du contrôle `repaymentId` : relit côté serveur le
   * prêt et l'échéance sélectionnée dès qu'une mensualité est choisie, pour
   * vérifier (dans cet ordre) qu'elle appartient bien au client connecté,
   * que le prêt est toujours remboursable, que l'échéance est encore
   * payable et que le solde du portefeuille couvre son montant. N'effectue
   * aucun appel HTTP direct : passe uniquement par `LoanService`,
   * `RepaymentService` et `UserService`.
   */
  private repaymentAsyncValidator(control: AbstractControl): Observable<ValidationErrors | null> {
    const installmentId = control.value;
    if (!installmentId) {
      return of(null);
    }

    const user = this.authService.getCurrentUser();
    const loan = this.loan();
    if (!user || !loan) {
      return of({ repaymentCheckFailed: true });
    }

    return forkJoin({
      freshLoan: this.loanService.getById(loan.id),
      freshInstallment: this.repaymentService.getById(installmentId),
      freshUser: this.userService.getById(user.id),
    }).pipe(
      map(({ freshLoan, freshInstallment, freshUser }) => {
        if (freshLoan.userId !== user.id) {
          return { loanNotOwned: true };
        }
        if (!isRepayableLoan(freshLoan)) {
          return { loanNotRepayable: true };
        }
        const payableStatuses: RepaymentStatus[] = [
          RepaymentStatus.PLANIFIE,
          RepaymentStatus.EN_RETARD,
          RepaymentStatus.IMPAYE,
        ];
        if (!payableStatuses.includes(freshInstallment.status)) {
          return { installmentNotPayable: true };
        }
        const amount = freshInstallment.amountDue + (freshInstallment.lateFee ?? 0);
        if (amount > freshUser.walletBalance) {
          return { insufficientBalance: true };
        }
        return null;
      }),
      catchError(() => of({ repaymentCheckFailed: true })),
    );
  }

  isRepayableLoan(loan: Loan): boolean {
    return isRepayableLoan(loan);
  }

  payInstallment(): void {
    if (this.repaymentSubmitting()) return;

    // Bloque la soumission tant que la validation asynchrone de l'échéance
    // sélectionnée est en cours (PENDING) ou a échoué : le message d'erreur
    // déjà porté par le contrôle (voir `repaymentCheckErrorMessage`) est
    // repris tel quel, sauf pour une simple absence de sélection (`required`),
    // qui ne doit écraser aucun message déjà affiché par ailleurs.
    if (!this.repaymentForm.valid) {
      if (!this.repaymentForm.pending) {
        const message = this.repaymentCheckErrorMessage();
        if (message) {
          this.repaymentErrorMessage.set(message);
        }
      }
      return;
    }

    const user = this.authService.getCurrentUser();
    if (!user) {
      this.repaymentErrorMessage.set('Utilisateur non connecté.');
      return;
    }

    if (this.accountSuspended()) {
      this.repaymentErrorMessage.set('Votre compte est suspendu. Vous ne pouvez plus effectuer de remboursement.');
      return;
    }

    const loan = this.loan();
    if (!loan || !isRepayableLoan(loan)) {
      this.repaymentErrorMessage.set("Ce prêt n'est pas éligible au remboursement.");
      return;
    }

    const installment = this.selectedInstallment();
    if (
      !installment ||
      (installment.status !== RepaymentStatus.PLANIFIE &&
        installment.status !== RepaymentStatus.EN_RETARD &&
        installment.status !== RepaymentStatus.IMPAYE)
    ) {
      this.repaymentErrorMessage.set("Cette mensualité n'est plus payable.");
      return;
    }

    const estimatedAmount = installment.amountDue + (installment.lateFee ?? 0);
    if (estimatedAmount <= 0) {
      this.repaymentErrorMessage.set('Montant de remboursement invalide.');
      return;
    }
    if (estimatedAmount > this.walletBalance()) {
      this.repaymentErrorMessage.set('Solde insuffisant pour payer cette mensualité.');
      return;
    }

    this.pendingAction.set('installment');
  }

  onConfirmModalCancel(): void {
    this.pendingAction.set(null);
  }

  onConfirmModalConfirm(): void {
    const action = this.pendingAction();
    if (action === 'installment') {
      this.confirmPayInstallment();
    } else if (action === 'total') {
      this.confirmPayTotal();
    }
  }

  private closeConfirmModal(): void {
    this.repaymentSubmitting.set(false);
    this.pendingAction.set(null);
  }

  private confirmPayInstallment(): void {
    if (this.repaymentSubmitting()) return;

    const user = this.authService.getCurrentUser();
    const loan = this.loan();
    const installment = this.selectedInstallment();
    if (!user || !loan || !installment) {
      this.pendingAction.set(null);
      return;
    }

    this.repaymentSubmitting.set(true);
    this.repaymentSuccessMessage.set(null);
    this.repaymentErrorMessage.set(null);

    // JSON Server ne garantit aucune atomicité : on relit le prêt, la
    // mensualité et le solde du portefeuille côté serveur juste avant de
    // débiter, pour ne pas se fier à un état local qui pourrait être périmé
    // et éviter de calculer un montant (ou un solde suspendu) incorrect.
    forkJoin({
      freshLoan: this.loanService.getById(loan.id),
      freshInstallment: this.repaymentService.getById(installment.id),
      freshUser: this.userService.getById(user.id),
    }).subscribe({
      next: ({ freshLoan, freshInstallment, freshUser }) => {
        if (freshUser.status === UserStatus.SUSPENDED) {
          this.repaymentErrorMessage.set('Votre compte est suspendu. Vous ne pouvez plus effectuer de remboursement.');
          this.closeConfirmModal();
          this.accountSuspended.set(true);
          return;
        }
        if (!isRepayableLoan(freshLoan)) {
          this.repaymentErrorMessage.set("Ce prêt n'est plus éligible au remboursement.");
          this.closeConfirmModal();
          this.refreshLoanAndRepayments(freshLoan.id);
          return;
        }
        if (
          freshInstallment.status !== RepaymentStatus.PLANIFIE &&
          freshInstallment.status !== RepaymentStatus.EN_RETARD &&
          freshInstallment.status !== RepaymentStatus.IMPAYE
        ) {
          this.repaymentErrorMessage.set("Cette mensualité n'est plus payable.");
          this.closeConfirmModal();
          this.refreshLoanAndRepayments(freshLoan.id);
          return;
        }

        const amount = freshInstallment.amountDue + (freshInstallment.lateFee ?? 0);
        this.walletBalance.set(freshUser.walletBalance);
        if (amount > freshUser.walletBalance) {
          this.repaymentErrorMessage.set('Solde insuffisant pour payer cette mensualité.');
          this.closeConfirmModal();
          return;
        }

        const transaction: Omit<Transaction, 'id' | 'createdAt'> = {
          type: TransactionType.REMBOURSEMENT_PRET,
          status: TransactionStatus.REUSSIE,
          amount,
          senderId: user.id,
          relatedLoanId: freshLoan.id,
          description: `Remboursement mensualité n°${freshInstallment.installmentNumber} - prêt ${freshLoan.id}`,
        };

        this.transactionService.create(transaction).subscribe({
          next: (createdTransaction) => {
            const now = new Date().toISOString();
            const newWalletBalance = freshUser.walletBalance - amount;
            // `remainingBalance` ne suit que le capital + intérêts (la somme
            // des `amountDue` de l'échéancier) : la pénalité de retard,
            // réglée en même temps, ne doit pas venir s'y soustraire une
            // deuxième fois (elle n'y avait jamais été ajoutée).
            const newRemainingBalance = Math.max(0, freshLoan.remainingBalance - freshInstallment.amountDue);
            const loanChanges: Partial<Loan> = { remainingBalance: newRemainingBalance };
            if (newRemainingBalance === 0) {
              loanChanges.status = LoanStatus.REMBOURSE;
              loanChanges.endDate = now;
            } else {
              // Si cette mensualité était la dernière encore en retard, le
              // prêt redevient EN_COURS dans le même PATCH ; s'il en reste
              // d'autres, il reste EN_RETARD (voir `deriveLoanStatus`).
              const projectedRepayments = this.repayments().map((installment) =>
                installment.id === freshInstallment.id
                  ? { ...installment, status: RepaymentStatus.PAYE }
                  : installment,
              );
              const nextStatus = deriveLoanStatus(freshLoan, projectedRepayments);
              if (nextStatus !== freshLoan.status) {
                loanChanges.status = nextStatus;
              }
            }

            forkJoin({
              user: this.userService.update(user.id, { walletBalance: newWalletBalance }),
              repayment: this.repaymentService.update(freshInstallment.id, {
                status: RepaymentStatus.PAYE,
                amountPaid: amount,
                paymentDate: now,
              }),
              loan: this.loanService.update(freshLoan.id, loanChanges),
            }).subscribe({
              next: ({ user: updatedUser }) => {
                this.walletBalance.set(updatedUser.walletBalance);
                this.repaymentSuccessMessage.set('Mensualité payée avec succès.');
                this.closeConfirmModal();
                this.refreshLoanAndRepayments(freshLoan.id);
              },
              error: () => {
                // La transaction est déjà enregistrée en REUSSIE mais le
                // débit/l'échéance/le prêt n'ont pas pu être mis à jour : on
                // corrige son statut pour ne pas laisser un enregistrement
                // "réussi" alors que le remboursement n'a pas réellement abouti.
                this.transactionService
                  .update(createdTransaction.id, { status: TransactionStatus.ECHOUEE })
                  .subscribe();
                this.repaymentErrorMessage.set(
                  "Le remboursement a été enregistré mais la mise à jour de votre compte a échoué. Contactez le support.",
                );
                this.closeConfirmModal();
              },
            });
          },
          error: () => {
            this.repaymentErrorMessage.set("Impossible d'effectuer le remboursement. Veuillez réessayer.");
            this.closeConfirmModal();
          },
        });
      },
      error: () => {
        this.repaymentErrorMessage.set("Impossible d'effectuer le remboursement. Veuillez réessayer.");
        this.closeConfirmModal();
      },
    });
  }

  payTotal(): void {
    if (this.repaymentSubmitting()) return;

    const user = this.authService.getCurrentUser();
    if (!user) {
      this.repaymentErrorMessage.set('Utilisateur non connecté.');
      return;
    }

    if (this.accountSuspended()) {
      this.repaymentErrorMessage.set('Votre compte est suspendu. Vous ne pouvez plus effectuer de remboursement.');
      return;
    }

    const loan = this.loan();
    if (!loan || !isRepayableLoan(loan)) {
      this.repaymentErrorMessage.set("Ce prêt n'est pas éligible au remboursement.");
      return;
    }

    // Vérification rapide côté client sur la valeur en cache, pour échouer
    // tôt sans appel réseau si le solde est visiblement insuffisant. Le
    // montant réellement débité, lui, n'est jamais calculé à partir de cette
    // valeur : voir le recalcul à partir de l'échéancier ci-dessous.
    const estimatedAmount = loan.remainingBalance;
    if (estimatedAmount <= 0) {
      this.repaymentErrorMessage.set('Ce prêt est déjà entièrement remboursé.');
      return;
    }
    if (estimatedAmount > this.walletBalance()) {
      this.repaymentErrorMessage.set('Solde insuffisant pour rembourser le solde total.');
      return;
    }

    this.pendingAction.set('total');
  }

  private confirmPayTotal(): void {
    if (this.repaymentSubmitting()) return;

    const user = this.authService.getCurrentUser();
    const loan = this.loan();
    if (!user || !loan) {
      this.pendingAction.set(null);
      return;
    }

    this.repaymentSubmitting.set(true);
    this.repaymentSuccessMessage.set(null);
    this.repaymentErrorMessage.set(null);

    // Relecture du prêt, de son échéancier ET du solde du portefeuille côté
    // serveur juste avant le débit : le montant réellement dû est recalculé
    // à partir des échéances encore impayées (capital + pénalités), pas
    // depuis la seule valeur en cache `remainingBalance`/`walletBalance` qui
    // pourrait être désynchronisée.
    forkJoin({
      freshLoan: this.loanService.getById(loan.id),
      freshRepayments: this.repaymentService.getByLoan(loan.id),
      freshUser: this.userService.getById(user.id),
    }).subscribe({
      next: ({ freshLoan, freshRepayments, freshUser }) => {
        if (freshUser.status === UserStatus.SUSPENDED) {
          this.repaymentErrorMessage.set('Votre compte est suspendu. Vous ne pouvez plus effectuer de remboursement.');
          this.closeConfirmModal();
          this.accountSuspended.set(true);
          return;
        }
        if (!isRepayableLoan(freshLoan)) {
          this.repaymentErrorMessage.set("Ce prêt n'est plus éligible au remboursement.");
          this.closeConfirmModal();
          this.refreshLoanAndRepayments(freshLoan.id);
          return;
        }

        const outstandingInstallments = freshRepayments.filter(
          (installment) =>
            installment.status === RepaymentStatus.PLANIFIE ||
            installment.status === RepaymentStatus.EN_RETARD ||
            installment.status === RepaymentStatus.IMPAYE,
        );

        const amount = outstandingInstallments.reduce(
          (sum, installment) => sum + installment.amountDue + (installment.lateFee ?? 0),
          0,
        );

        this.walletBalance.set(freshUser.walletBalance);
        if (amount <= 0) {
          this.repaymentErrorMessage.set('Ce prêt est déjà entièrement remboursé.');
          this.closeConfirmModal();
          return;
        }
        if (amount > freshUser.walletBalance) {
          this.repaymentErrorMessage.set('Solde insuffisant pour rembourser le solde total.');
          this.closeConfirmModal();
          return;
        }

        const transaction: Omit<Transaction, 'id' | 'createdAt'> = {
          type: TransactionType.REMBOURSEMENT_PRET,
          status: TransactionStatus.REUSSIE,
          amount,
          senderId: user.id,
          relatedLoanId: freshLoan.id,
          description: `Remboursement total du prêt ${freshLoan.id}`,
        };

        this.transactionService.create(transaction).subscribe({
          next: (createdTransaction) => {
            const now = new Date().toISOString();
            const newWalletBalance = freshUser.walletBalance - amount;
            const repaymentUpdates = outstandingInstallments.length
              ? forkJoin(
                  outstandingInstallments.map((installment) =>
                    this.repaymentService.update(installment.id, {
                      status: RepaymentStatus.PAYE,
                      amountPaid: installment.amountDue + (installment.lateFee ?? 0),
                      paymentDate: now,
                    }),
                  ),
                )
              : of([]);

            forkJoin({
              user: this.userService.update(user.id, { walletBalance: newWalletBalance }),
              loan: this.loanService.update(freshLoan.id, {
                remainingBalance: 0,
                status: LoanStatus.REMBOURSE,
                endDate: now,
              }),
              repayments: repaymentUpdates,
            }).subscribe({
              next: ({ user: updatedUser }) => {
                this.walletBalance.set(updatedUser.walletBalance);
                this.repaymentSuccessMessage.set('Prêt intégralement remboursé avec succès.');
                this.closeConfirmModal();
                this.refreshLoanAndRepayments(freshLoan.id);
              },
              error: () => {
                // Voir le même correctif dans `payInstallment()` : la
                // transaction ne doit pas rester REUSSIE si le remboursement
                // n'a en réalité pas pu être appliqué.
                this.transactionService
                  .update(createdTransaction.id, { status: TransactionStatus.ECHOUEE })
                  .subscribe();
                this.repaymentErrorMessage.set(
                  "Le remboursement a été enregistré mais la mise à jour de votre compte a échoué. Contactez le support.",
                );
                this.closeConfirmModal();
              },
            });
          },
          error: () => {
            this.repaymentErrorMessage.set("Impossible d'effectuer le remboursement. Veuillez réessayer.");
            this.closeConfirmModal();
          },
        });
      },
      error: () => {
        this.repaymentErrorMessage.set("Impossible d'effectuer le remboursement. Veuillez réessayer.");
        this.closeConfirmModal();
      },
    });
  }

  /**
   * Recharge le prêt après un remboursement réussi. En cas d'échec, on
   * conserve l'affichage existant (le remboursement est déjà acquis côté
   * serveur) plutôt que de basculer tout l'écran en erreur, ce qui
   * masquerait le message de succès déjà affiché.
   */
  private refreshLoanAndRepayments(loanId: string): void {
    forkJoin({
      loan: this.loanService.getById(loanId),
      repayments: this.repaymentService.getByLoan(loanId),
    }).subscribe({
      next: ({ loan, repayments }) => {
        this.loan.set(loan);
        this.repayments.set(repayments);
        this.repaymentForm.reset();
      },
      error: () => {
        // Le remboursement est déjà enregistré ; seul le rafraîchissement a
        // échoué. L'utilisateur peut rafraîchir via "Réessayer".
      },
    });
  }

  readonly formatCurrency = formatCurrency;
  readonly formatDate = formatDate;
  readonly loanStatusLabel = loanStatusLabel;
  readonly loanStatusClass = loanStatusClass;
  readonly repaymentStatusLabel = repaymentStatusLabel;
  readonly repaymentStatusClass = repaymentStatusClass;
  readonly isLateRepayment = isLateRepayment;
  readonly daysLate = daysLateForRepayment;
}
