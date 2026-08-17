import { Component, signal, computed, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DashboardService, ClientDashboardData } from '../../../core/services/dashboard.service';
import { AuthService } from '../../../core/services/auth.service';
import { TransactionType, TransactionStatus } from '../../../core/models/transaction.model';
import { LoanStatus, Loan } from '../../../core/models/loan.model';
import { CreditScoreCategory } from '../../../core/models/credit-score.model';
import { creditScoreCategoryClass, creditScoreCategoryLabel } from '../../../core/utils/credit-score.util';

@Component({
  selector: 'app-client-dashboard',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './client-dashboard.component.html',
  styleUrl: './client-dashboard.component.css'
})
export class ClientDashboardComponent implements OnInit {
  private readonly dashboardService = inject(DashboardService);
  private readonly authService = inject(AuthService);

  readonly currentUser = this.authService.currentUser;

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly data = signal<ClientDashboardData | null>(null);

  readonly walletBalance = computed(() => this.data()?.user.walletBalance ?? 0);

  readonly totalIn = computed(() => {
    const transactions = this.data()?.recentTransactions ?? [];
    const userId = this.currentUser()?.id;
    if (!userId) return 0;
    return transactions
      .filter(t => t.status === TransactionStatus.REUSSIE && t.receiverId === userId)
      .reduce((sum, t) => sum + t.amount, 0);
  });

  readonly totalOut = computed(() => {
    const transactions = this.data()?.recentTransactions ?? [];
    const userId = this.currentUser()?.id;
    if (!userId) return 0;
    return transactions
      .filter(t => t.status === TransactionStatus.REUSSIE && t.senderId === userId)
      .reduce((sum, t) => sum + t.amount, 0);
  });

  readonly creditScore = computed(() => this.data()?.creditScore);

  readonly activeLoansCount = computed(() => {
    return this.data()?.loans.filter(l => l.status === LoanStatus.EN_COURS).length ?? 0;
  });

  readonly overdueLoansCount = computed(() => {
    return this.data()?.loans.filter(l => l.status === LoanStatus.EN_RETARD).length ?? 0;
  });

  readonly recentTransactions = computed(() => this.data()?.recentTransactions ?? []);

  readonly activeLoans = computed(() => {
    return this.data()?.loans.filter(l => l.status === LoanStatus.EN_COURS) ?? [];
  });

  ngOnInit(): void {
    const user = this.authService.getCurrentUser();
    if (!user) {
      this.error.set('Utilisateur non connecté.');
      this.loading.set(false);
      return;
    }

    this.loading.set(true);
    this.error.set(null);

    this.dashboardService.getClientDashboard(user.id).subscribe({
      next: (dashboardData) => {
        this.data.set(dashboardData);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Impossible de charger les données du tableau de bord.');
        this.loading.set(false);
      },
    });
  }

  retry(): void {
    const user = this.authService.getCurrentUser();
    if (!user) return;

    this.loading.set(true);
    this.error.set(null);

    this.dashboardService.getClientDashboard(user.id).subscribe({
      next: (dashboardData) => {
        this.data.set(dashboardData);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Impossible de charger les données du tableau de bord.');
        this.loading.set(false);
      },
    });
  }

  formatCurrency(value: number): string {
    return new Intl.NumberFormat('fr-FR').format(value) + ' FCFA';
  }

  formatNumber(value: number): string {
    return new Intl.NumberFormat('fr-FR').format(value);
  }

  transactionTypeLabel(type: TransactionType): string {
    switch (type) {
      case TransactionType.DEPOT:
        return 'Dépôt';
      case TransactionType.RETRAIT:
        return 'Retrait';
      case TransactionType.VIREMENT:
        return 'Virement';
      case TransactionType.DECAISSEMENT_PRET:
        return 'Décaissement prêt';
      case TransactionType.REMBOURSEMENT_PRET:
        return 'Remboursement prêt';
      default:
        return type;
    }
  }

  transactionStatusClass(status: TransactionStatus): string {
    switch (status) {
      case TransactionStatus.REUSSIE:
        return 'badge-success';
      case TransactionStatus.EN_ATTENTE:
        return 'badge-warning';
      case TransactionStatus.ECHOUEE:
        return 'badge-danger';
      case TransactionStatus.ANNULEE:
        return 'badge-neutral';
      default:
        return 'badge-neutral';
    }
  }

  loanStatusLabel(status: LoanStatus): string {
    switch (status) {
      case LoanStatus.EN_COURS:
        return 'En cours';
      case LoanStatus.EN_RETARD:
        return 'En retard';
      case LoanStatus.EN_ATTENTE:
        return 'En attente';
      case LoanStatus.APPROUVE:
        return 'Approuvé';
      case LoanStatus.REJETE:
        return 'Rejeté';
      case LoanStatus.REMBOURSE:
        return 'Remboursé';
      default:
        return status;
    }
  }

  loanStatusClass(status: LoanStatus): string {
    switch (status) {
      case LoanStatus.EN_COURS:
        return 'badge-success';
      case LoanStatus.EN_RETARD:
        return 'badge-danger';
      case LoanStatus.EN_ATTENTE:
        return 'badge-warning';
      case LoanStatus.APPROUVE:
        return 'badge-info';
      case LoanStatus.REJETE:
        return 'badge-neutral';
      case LoanStatus.REMBOURSE:
        return 'badge-neutral';
      default:
        return 'badge-neutral';
    }
  }

  scoreCategoryLabel(category: CreditScoreCategory): string {
    return creditScoreCategoryLabel(category);
  }

  scoreCategoryClass(category: CreditScoreCategory): string {
    return creditScoreCategoryClass(category);
  }
}
