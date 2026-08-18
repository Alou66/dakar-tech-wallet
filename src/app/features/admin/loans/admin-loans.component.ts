import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';

import { AdminLoansManagementData, DashboardService } from '../../../core/services/dashboard.service';
import { LoanService } from '../../../core/services/loan.service';
import { Loan, LoanStatus } from '../../../core/models/loan.model';
import { User } from '../../../core/models/user.model';
import { CreditScore, CreditScoreCategory } from '../../../core/models/credit-score.model';
import { creditScoreCategoryClass, creditScoreCategoryLabel } from '../../../core/utils/credit-score.util';

type StatusFilter = LoanStatus | 'ALL';
type CategoryFilter = CreditScoreCategory | 'ALL';
type PendingAction = { loanId: string; action: 'approve' | 'reject' };

@Component({
  selector: 'app-admin-loans',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './admin-loans.component.html',
  styleUrl: './admin-loans.component.css',
})
export class AdminLoansComponent implements OnInit {
  private readonly dashboardService = inject(DashboardService);
  private readonly loanService = inject(LoanService);

  readonly LoanStatus = LoanStatus;
  readonly CreditScoreCategory = CreditScoreCategory;

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly data = signal<AdminLoansManagementData | null>(null);

  readonly searchTerm = signal('');
  readonly statusFilter = signal<StatusFilter>('ALL');
  readonly categoryFilter = signal<CategoryFilter>('ALL');

  readonly pendingAction = signal<PendingAction | null>(null);
  readonly actionSubmitting = signal(false);
  readonly actionError = signal<string | null>(null);
  readonly actionSuccess = signal<string | null>(null);

  readonly hasLoans = computed(() => (this.data()?.loans.length ?? 0) > 0);

  private readonly usersById = computed(() => {
    const map = new Map<string, User>();
    for (const user of this.data()?.users ?? []) {
      map.set(user.id, user);
    }
    return map;
  });

  private readonly creditScoreByUserId = computed(() => {
    const map = new Map<string, CreditScore>();
    for (const score of this.data()?.creditScores ?? []) {
      map.set(score.userId, score);
    }
    return map;
  });

  readonly filteredLoans = computed(() => {
    const loans = this.data()?.loans ?? [];
    const term = this.searchTerm().trim().toLowerCase();
    const status = this.statusFilter();
    const category = this.categoryFilter();
    const usersById = this.usersById();
    const creditScoreByUserId = this.creditScoreByUserId();

    return loans
      .filter((loan) => {
        if (status !== 'ALL' && loan.status !== status) return false;

        if (category !== 'ALL') {
          const score = creditScoreByUserId.get(loan.userId);
          if (!score || score.category !== category) return false;
        }

        if (term) {
          const user = usersById.get(loan.userId);
          if (!this.userMatchesTerm(user, term)) return false;
        }

        return true;
      })
      .sort((a, b) => new Date(b.requestDate).getTime() - new Date(a.requestDate).getTime());
  });

  readonly hasFilteredResults = computed(() => this.filteredLoans().length > 0);

  readonly hasActiveFilters = computed(
    () => this.searchTerm().trim() !== '' || this.statusFilter() !== 'ALL' || this.categoryFilter() !== 'ALL',
  );

  readonly pendingActionLoan = computed(() => {
    const pending = this.pendingAction();
    if (!pending) return null;
    return this.data()?.loans.find((loan) => loan.id === pending.loanId) ?? null;
  });

  ngOnInit(): void {
    this.load();
  }

  retry(): void {
    this.load();
  }

  onSearchChange(event: Event): void {
    this.searchTerm.set((event.target as HTMLInputElement).value);
  }

  onStatusFilterChange(event: Event): void {
    this.statusFilter.set((event.target as HTMLSelectElement).value as StatusFilter);
  }

  onCategoryFilterChange(event: Event): void {
    this.categoryFilter.set((event.target as HTMLSelectElement).value as CategoryFilter);
  }

  resetFilters(): void {
    this.searchTerm.set('');
    this.statusFilter.set('ALL');
    this.categoryFilter.set('ALL');
  }

  userFor(userId: string): User | undefined {
    return this.usersById().get(userId);
  }

  userLabel(userId: string): string {
    const user = this.userFor(userId);
    return user ? `${user.firstName} ${user.lastName}` : '—';
  }

  userAccountNumber(userId: string): string | undefined {
    return this.userFor(userId)?.accountNumber;
  }

  creditScoreFor(userId: string): CreditScore | undefined {
    return this.creditScoreByUserId().get(userId);
  }

  isPending(loan: Loan): boolean {
    return loan.status === LoanStatus.EN_ATTENTE;
  }

  requestApprove(loan: Loan): void {
    if (!this.isPending(loan) || this.actionSubmitting()) return;
    this.actionError.set(null);
    this.actionSuccess.set(null);
    this.pendingAction.set({ loanId: loan.id, action: 'approve' });
  }

  requestReject(loan: Loan): void {
    if (!this.isPending(loan) || this.actionSubmitting()) return;
    this.actionError.set(null);
    this.actionSuccess.set(null);
    this.pendingAction.set({ loanId: loan.id, action: 'reject' });
  }

  cancelAction(): void {
    if (this.actionSubmitting()) return;
    this.pendingAction.set(null);
    this.actionError.set(null);
  }

  /**
   * Approbation/rejet : une seule requête, atomique côté serveur (validation,
   * décaissement et génération de l'échéancier se font en une seule
   * transaction — voir `LoanService.approve` côté backend). Il n'existe plus
   * d'état intermédiaire "approuvé mais pas encore décaissé" à reprendre
   * manuellement.
   */
  confirmAction(): void {
    const pending = this.pendingAction();
    if (!pending || this.actionSubmitting()) return;

    this.actionSubmitting.set(true);
    this.actionError.set(null);
    this.actionSuccess.set(null);

    const request =
      pending.action === 'approve' ? this.loanService.approve(pending.loanId) : this.loanService.reject(pending.loanId);

    request.subscribe({
      next: (updatedLoan) => {
        this.patchLoanInData(updatedLoan);
        this.actionSuccess.set(
          pending.action === 'approve'
            ? 'Demande validée : le prêt a été approuvé, décaissé et son échéancier généré.'
            : 'Demande rejetée.',
        );
        this.actionSubmitting.set(false);
        this.pendingAction.set(null);
      },
      error: (err: HttpErrorResponse) => {
        this.actionError.set(err.error?.message ?? 'Impossible de traiter cette demande. Veuillez réessayer.');
        this.actionSubmitting.set(false);
        this.pendingAction.set(null);
      },
    });
  }

  private patchLoanInData(loan: Loan): void {
    this.data.update((current) =>
      current ? { ...current, loans: current.loans.map((l) => (l.id === loan.id ? loan : l)) } : current,
    );
  }

  formatCurrency(value: number): string {
    return new Intl.NumberFormat('fr-FR').format(value) + ' FCFA';
  }

  formatDate(dateString?: string): string {
    if (!dateString) return '—';
    return new Date(dateString).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }

  statusLabel(status: LoanStatus): string {
    switch (status) {
      case LoanStatus.EN_ATTENTE:
        return 'En attente';
      case LoanStatus.APPROUVE:
        return 'Approuvé';
      case LoanStatus.REJETE:
        return 'Rejeté';
      case LoanStatus.EN_COURS:
        return 'En cours';
      case LoanStatus.EN_RETARD:
        return 'En retard';
      case LoanStatus.REMBOURSE:
        return 'Remboursé';
      default:
        return status;
    }
  }

  statusClass(status: LoanStatus): string {
    switch (status) {
      case LoanStatus.EN_ATTENTE:
        return 'badge-warning';
      case LoanStatus.APPROUVE:
        return 'badge-info';
      case LoanStatus.EN_COURS:
        return 'badge-active';
      case LoanStatus.EN_RETARD:
        return 'badge-danger';
      case LoanStatus.REMBOURSE:
        return 'badge-success';
      case LoanStatus.REJETE:
        return 'badge-neutral';
      default:
        return 'badge-neutral';
    }
  }

  creditScoreCategoryLabel(category: CreditScoreCategory): string {
    return creditScoreCategoryLabel(category);
  }

  creditScoreCategoryClass(category: CreditScoreCategory): string {
    return creditScoreCategoryClass(category);
  }

  private userMatchesTerm(user: User | undefined, term: string): boolean {
    if (!user) return false;
    const fullName = `${user.firstName} ${user.lastName}`.toLowerCase();
    return (
      fullName.includes(term) ||
      user.email.toLowerCase().includes(term) ||
      user.accountNumber.toLowerCase().includes(term)
    );
  }

  private load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.pendingAction.set(null);
    this.actionError.set(null);
    this.actionSuccess.set(null);

    this.dashboardService.getAdminLoansManagement().subscribe({
      next: (data) => {
        this.data.set(data);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Impossible de charger la liste des prêts.');
        this.loading.set(false);
      },
    });
  }
}
