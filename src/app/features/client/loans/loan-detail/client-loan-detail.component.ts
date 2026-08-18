import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { forkJoin } from 'rxjs';

import { LoanService } from '../../../../core/services/loan.service';
import { RepaymentService } from '../../../../core/services/repayment.service';
import { UserService } from '../../../../core/services/user.service';
import { AuthService } from '../../../../core/services/auth.service';
import { Loan } from '../../../../core/models/loan.model';
import { UserStatus } from '../../../../core/models/user.model';
import { Repayment, RepaymentStatus } from '../../../../core/models/repayment.model';
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

  readonly repaymentForm: FormGroup = this.fb.group({
    repaymentId: ['', [Validators.required]],
  });

  private readonly repaymentFormValue = toSignal(this.repaymentForm.valueChanges, {
    initialValue: this.repaymentForm.value,
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
    const loan = this.loan();
    const installment = this.selectedInstallment();
    if (!loan || !installment || this.accountSuspended() || this.repaymentSubmitting() || !isRepayableLoan(loan)) {
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
    this.loadLoan(loanId);

    this.userService.getById(user.id).subscribe({
      next: (freshUser) => {
        this.walletBalance.set(freshUser.walletBalance);
        this.accountSuspended.set(freshUser.status === UserStatus.SUSPENDED);
      },
    });
  }

  retry(): void {
    const loanId = this.route.snapshot.paramMap.get('id');
    if (!loanId) return;
    this.loadLoan(loanId);
  }

  /**
   * Le statut du prêt et de son échéancier est déjà à jour côté serveur (la
   * synchronisation des retards tourne automatiquement, voir
   * `RepaymentService.syncOverdueStatuses` côté backend) : un simple GET
   * suffit, plus besoin de PATCH corrective après lecture.
   */
  private loadLoan(loanId: string): void {
    this.loading.set(true);
    this.error.set(null);

    forkJoin({
      loan: this.loanService.getById(loanId),
      repayments: this.repaymentService.getByLoan(loanId),
    }).subscribe({
      next: ({ loan, repayments }) => {
        this.loan.set(loan);
        this.repayments.set(repayments);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Impossible de charger ce prêt.');
        this.loading.set(false);
      },
    });
  }

  toggleSchedule(): void {
    this.scheduleExpanded.update((expanded) => !expanded);
  }

  isRepayableLoan(loan: Loan): boolean {
    return isRepayableLoan(loan);
  }

  payInstallment(): void {
    if (this.repaymentSubmitting() || this.canPayInstallment() === false) return;
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

  /** Débit, écriture de la transaction et mise à jour de l'échéance/du prêt sont atomiques côté serveur. */
  private confirmPayInstallment(): void {
    if (this.repaymentSubmitting()) return;

    const installment = this.selectedInstallment();
    const loan = this.loan();
    if (!installment || !loan) {
      this.pendingAction.set(null);
      return;
    }

    this.repaymentSubmitting.set(true);
    this.repaymentSuccessMessage.set(null);
    this.repaymentErrorMessage.set(null);

    this.repaymentService.payInstallment(installment.id).subscribe({
      next: () => {
        this.repaymentSuccessMessage.set('Mensualité payée avec succès.');
        this.closeConfirmModal();
        this.repaymentForm.reset();
        this.refreshAfterPayment(loan.id);
      },
      error: (err: HttpErrorResponse) => {
        this.repaymentErrorMessage.set(err.error?.message ?? "Impossible d'effectuer le remboursement. Veuillez réessayer.");
        this.closeConfirmModal();
        this.refreshAfterPayment(loan.id);
      },
    });
  }

  payTotal(): void {
    if (this.repaymentSubmitting() || this.canPayTotal() === false) return;
    this.pendingAction.set('total');
  }

  private confirmPayTotal(): void {
    if (this.repaymentSubmitting()) return;

    const loan = this.loan();
    if (!loan) {
      this.pendingAction.set(null);
      return;
    }

    this.repaymentSubmitting.set(true);
    this.repaymentSuccessMessage.set(null);
    this.repaymentErrorMessage.set(null);

    this.repaymentService.payTotal(loan.id).subscribe({
      next: () => {
        this.repaymentSuccessMessage.set('Prêt intégralement remboursé avec succès.');
        this.closeConfirmModal();
        this.refreshAfterPayment(loan.id);
      },
      error: (err: HttpErrorResponse) => {
        this.repaymentErrorMessage.set(err.error?.message ?? "Impossible d'effectuer le remboursement. Veuillez réessayer.");
        this.closeConfirmModal();
        this.refreshAfterPayment(loan.id);
      },
    });
  }

  /** Recharge le prêt, son échéancier et le solde du portefeuille après un paiement (réussi ou non). */
  private refreshAfterPayment(loanId: string): void {
    const user = this.authService.getCurrentUser();

    forkJoin({
      loan: this.loanService.getById(loanId),
      repayments: this.repaymentService.getByLoan(loanId),
    }).subscribe({
      next: ({ loan, repayments }) => {
        this.loan.set(loan);
        this.repayments.set(repayments);
      },
    });

    if (user) {
      this.userService.getById(user.id).subscribe({
        next: (freshUser) => this.walletBalance.set(freshUser.walletBalance),
      });
    }
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
