import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

import {
  AdminTransactionsManagementData,
  DashboardService,
} from '../../../core/services/dashboard.service';
import { Transaction, TransactionStatus, TransactionType } from '../../../core/models/transaction.model';
import { User } from '../../../core/models/user.model';

type TypeFilter = TransactionType | 'ALL';
type StatusFilter = TransactionStatus | 'ALL';

@Component({
  selector: 'app-admin-transactions',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './admin-transactions.component.html',
  styleUrl: './admin-transactions.component.css',
})
export class AdminTransactionsComponent implements OnInit {
  private readonly dashboardService = inject(DashboardService);

  readonly TransactionType = TransactionType;
  readonly TransactionStatus = TransactionStatus;

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly data = signal<AdminTransactionsManagementData | null>(null);

  readonly searchTerm = signal('');
  readonly typeFilter = signal<TypeFilter>('ALL');
  readonly statusFilter = signal<StatusFilter>('ALL');
  readonly dateFrom = signal('');
  readonly dateTo = signal('');

  readonly hasTransactions = computed(() => (this.data()?.transactions.length ?? 0) > 0);

  private readonly usersById = computed(() => {
    const map = new Map<string, User>();
    for (const user of this.data()?.users ?? []) {
      map.set(user.id, user);
    }
    return map;
  });

  readonly filteredTransactions = computed(() => {
    const transactions = this.data()?.transactions ?? [];
    const term = this.searchTerm().trim().toLowerCase();
    const type = this.typeFilter();
    const status = this.statusFilter();
    const from = this.dateFrom();
    const to = this.dateTo();
    const usersById = this.usersById();

    return transactions
      .filter((tx) => {
        if (type !== 'ALL' && tx.type !== type) return false;
        if (status !== 'ALL' && tx.status !== status) return false;

        const txDate = tx.createdAt.slice(0, 10);
        if (from && txDate < from) return false;
        if (to && txDate > to) return false;

        if (term) {
          const sender = tx.senderId ? usersById.get(tx.senderId) : undefined;
          const receiver = tx.receiverId ? usersById.get(tx.receiverId) : undefined;
          const matchesSender = this.userMatchesTerm(sender, term);
          const matchesReceiver = this.userMatchesTerm(receiver, term);
          if (!matchesSender && !matchesReceiver) return false;
        }

        return true;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  });

  readonly hasFilteredResults = computed(() => this.filteredTransactions().length > 0);

  readonly hasActiveFilters = computed(
    () =>
      this.searchTerm().trim() !== '' ||
      this.typeFilter() !== 'ALL' ||
      this.statusFilter() !== 'ALL' ||
      this.dateFrom() !== '' ||
      this.dateTo() !== '',
  );

  ngOnInit(): void {
    this.load();
  }

  retry(): void {
    this.load();
  }

  onSearchChange(event: Event): void {
    this.searchTerm.set((event.target as HTMLInputElement).value);
  }

  onTypeFilterChange(event: Event): void {
    this.typeFilter.set((event.target as HTMLSelectElement).value as TypeFilter);
  }

  onStatusFilterChange(event: Event): void {
    this.statusFilter.set((event.target as HTMLSelectElement).value as StatusFilter);
  }

  onDateFromChange(event: Event): void {
    this.dateFrom.set((event.target as HTMLInputElement).value);
  }

  onDateToChange(event: Event): void {
    this.dateTo.set((event.target as HTMLInputElement).value);
  }

  resetFilters(): void {
    this.searchTerm.set('');
    this.typeFilter.set('ALL');
    this.statusFilter.set('ALL');
    this.dateFrom.set('');
    this.dateTo.set('');
  }

  userFor(userId: string | undefined): User | undefined {
    if (!userId) return undefined;
    return this.usersById().get(userId);
  }

  userLabel(userId: string | undefined): string {
    const user = this.userFor(userId);
    return user ? `${user.firstName} ${user.lastName}` : '—';
  }

  userAccountNumber(userId: string | undefined): string | undefined {
    return this.userFor(userId)?.accountNumber;
  }

  formatCurrency(value: number): string {
    return new Intl.NumberFormat('fr-FR').format(value) + ' FCFA';
  }

  formatDate(dateString: string): string {
    return new Date(dateString).toLocaleString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
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

  transactionStatusLabel(status: TransactionStatus): string {
    switch (status) {
      case TransactionStatus.EN_ATTENTE:
        return 'En attente';
      case TransactionStatus.REUSSIE:
        return 'Réussie';
      case TransactionStatus.ECHOUEE:
        return 'Échouée';
      case TransactionStatus.ANNULEE:
        return 'Annulée';
      default:
        return status;
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

    this.dashboardService.getAdminTransactionsManagement().subscribe({
      next: (data) => {
        this.data.set(data);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Impossible de charger les transactions.');
        this.loading.set(false);
      },
    });
  }
}
