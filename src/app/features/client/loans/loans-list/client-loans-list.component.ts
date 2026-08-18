import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';

import { LoanService } from '../../../../core/services/loan.service';
import { AuthService } from '../../../../core/services/auth.service';
import { UserService } from '../../../../core/services/user.service';
import { CreditScoreService } from '../../../../core/services/credit-score.service';
import { Loan } from '../../../../core/models/loan.model';
import { UserStatus } from '../../../../core/models/user.model';
import { CreditScore, CreditScoreCategory } from '../../../../core/models/credit-score.model';
import { creditScoreCategoryClass, creditScoreCategoryLabel } from '../../../../core/utils/credit-score.util';
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
  private readonly authService = inject(AuthService);
  private readonly userService = inject(UserService);
  private readonly creditScoreService = inject(CreditScoreService);

  /** Vérifié à chaque chargement du profil : un compte suspendu ne peut plus emprunter. */
  readonly accountSuspended = signal(false);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly loans = signal<Loan[]>([]);

  /**
   * Le statut des prêts/échéances et le score de solvabilité sont tenus à
   * jour côté serveur (synchronisation automatique des retards + recalcul
   * après chaque remboursement) : on se contente de les lire.
   */
  readonly creditScore = signal<CreditScore | undefined>(undefined);

  readonly sortedLoans = computed(() =>
    [...this.loans()].sort(
      (a, b) => new Date(b.requestDate).getTime() - new Date(a.requestDate).getTime(),
    ),
  );

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
      creditScore: this.creditScoreService.getByUser(userId),
    }).subscribe({
      next: ({ loans, creditScore }) => {
        this.loans.set(loans);
        this.creditScore.set(creditScore);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Impossible de charger vos prêts.');
        this.loading.set(false);
      },
    });
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
