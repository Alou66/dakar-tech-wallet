import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';

import { LoanService } from '../../../../core/services/loan.service';
import { RepaymentService } from '../../../../core/services/repayment.service';
import { AuthService } from '../../../../core/services/auth.service';
import { UserService } from '../../../../core/services/user.service';
import { CreditScoreService } from '../../../../core/services/credit-score.service';
import { Loan } from '../../../../core/models/loan.model';
import { UserStatus } from '../../../../core/models/user.model';
import { Repayment } from '../../../../core/models/repayment.model';
import { CreditScoreCategory } from '../../../../core/models/credit-score.model';
import { computeCreditScore, creditScoreCategoryClass, creditScoreCategoryLabel } from '../../../../core/utils/credit-score.util';
import {
  formatCurrency,
  formatDate,
  loanStatusClass,
  loanStatusLabel,
} from '../../../../core/utils/loan-display.util';

@Component({
  selector: 'app-client-loans-list',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './client-loans-list.component.html',
  styleUrl: './client-loans-list.component.css',
})
export class ClientLoansListComponent implements OnInit {
  private readonly loanService = inject(LoanService);
  private readonly repaymentService = inject(RepaymentService);
  private readonly authService = inject(AuthService);
  private readonly userService = inject(UserService);
  private readonly creditScoreService = inject(CreditScoreService);

  /** Vérifié à chaque chargement du profil : un compte suspendu ne peut plus emprunter. */
  readonly accountSuspended = signal(false);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly loans = signal<Loan[]>([]);
  readonly repayments = signal<Repayment[]>([]);

  readonly sortedLoans = computed(() =>
    [...this.loans()].sort(
      (a, b) => new Date(b.requestDate).getTime() - new Date(a.requestDate).getTime(),
    ),
  );

  readonly creditScoreError = signal<string | null>(null);

  /**
   * Score de solvabilité recalculé en direct à partir de l'historique réel
   * des remboursements du client : jamais figé sur la dernière valeur
   * persistée, il se met à jour dès que `repayments` change.
   */
  readonly creditScoreBreakdown = computed(() => computeCreditScore(this.repayments()));

  ngOnInit(): void {
    const user = this.authService.getCurrentUser();
    if (!user) {
      this.error.set('Utilisateur non connecté.');
      this.loading.set(false);
      return;
    }

    this.loadLoans(user.id);

    this.userService.getById(user.id).subscribe({
      next: (freshUser) => this.accountSuspended.set(freshUser.status === UserStatus.SUSPENDED),
    });
  }

  retry(): void {
    const user = this.authService.getCurrentUser();
    if (!user) return;
    this.loadLoans(user.id);
  }

  private loadLoans(userId: string): void {
    this.loading.set(true);
    this.error.set(null);

    forkJoin({
      loans: this.loanService.getByUser(userId),
      repayments: this.repaymentService.getByUser(userId),
    }).subscribe({
      next: ({ loans, repayments }) => {
        this.loans.set(loans);
        this.repayments.set(repayments);
        this.loading.set(false);
        this.syncOverdueStatusesAndScore(userId, repayments);
      },
      error: () => {
        this.error.set('Impossible de charger vos prêts.');
        this.loading.set(false);
      },
    });
  }

  /**
   * Reclasse EN_RETARD les échéances dépassées, aligne le statut de chaque
   * prêt sur son échéancier à jour, puis persiste un score de solvabilité
   * recalculé à partir de l'historique réel. L'affichage du score, lui,
   * dépend uniquement du signal `repayments` via `creditScoreBreakdown` et
   * reste à jour même si cette synchronisation échoue.
   */
  private syncOverdueStatusesAndScore(userId: string, repayments: Repayment[]): void {
    this.creditScoreError.set(null);

    this.repaymentService.syncOverdueStatuses(repayments).subscribe({
      next: (updatedRepayments) => {
        this.repayments.set(updatedRepayments);
        this.syncLoanStatuses(updatedRepayments);

        this.creditScoreService.recalculateForUser(userId, updatedRepayments).subscribe({
          error: () => this.creditScoreError.set('Impossible de sauvegarder votre score de solvabilité.'),
        });
      },
      error: () => this.creditScoreError.set('Impossible de mettre à jour les échéances en retard.'),
    });
  }

  /**
   * Aligne le statut de chaque prêt du client sur l'état réel de son
   * échéancier (voir `LoanService.syncStatusFromRepayments`), une fois les
   * échéances en retard reclassées ci-dessus.
   */
  private syncLoanStatuses(repayments: Repayment[]): void {
    const repaymentsByLoanId = new Map<string, Repayment[]>();
    for (const repayment of repayments) {
      const existing = repaymentsByLoanId.get(repayment.loanId) ?? [];
      existing.push(repayment);
      repaymentsByLoanId.set(repayment.loanId, existing);
    }

    for (const loan of this.loans()) {
      const loanRepayments = repaymentsByLoanId.get(loan.id) ?? [];
      this.loanService.syncStatusFromRepayments(loan, loanRepayments).subscribe({
        next: (updatedLoan) => {
          this.loans.update((loans) => loans.map((l) => (l.id === updatedLoan.id ? updatedLoan : l)));
        },
      });
    }
  }

  formatCurrency = formatCurrency;
  formatDate = formatDate;
  loanStatusLabel = loanStatusLabel;
  loanStatusClass = loanStatusClass;

  creditScoreCategoryLabel(category: CreditScoreCategory): string {
    return creditScoreCategoryLabel(category);
  }

  creditScoreCategoryClass(category: CreditScoreCategory): string {
    return creditScoreCategoryClass(category);
  }
}
