import { Component, signal, computed, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TransactionService } from '../../../core/services/transaction.service';
import { AuthService } from '../../../core/services/auth.service';
import { Transaction, TransactionType, TransactionStatus } from '../../../core/models/transaction.model';

@Component({
  selector: 'app-client-transactions',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './client-transactions.component.html',
  styleUrl: './client-transactions.component.css'
})
export class ClientTransactionsComponent implements OnInit {
  private readonly transactionService = inject(TransactionService);
  private readonly authService = inject(AuthService);

  readonly currentUser = this.authService.currentUser;

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly transactions = signal<Transaction[]>([]);

  readonly typeFilter = signal<TransactionType | 'ALL'>('ALL');
  readonly statusFilter = signal<TransactionStatus | 'ALL'>('ALL');

  readonly filteredTransactions = computed(() => {
    const all = this.transactions();
    const type = this.typeFilter();
    const status = this.statusFilter();

    return all
      .filter(t => type === 'ALL' || t.type === type)
      .filter(t => status === 'ALL' || t.status === status)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  });

  ngOnInit(): void {
    const user = this.authService.getCurrentUser();
    if (!user) {
      this.error.set('Utilisateur non connecté.');
      this.loading.set(false);
      return;
    }

    this.loadTransactions(user.id);
  }

  retry(): void {
    const user = this.authService.getCurrentUser();
    if (!user) return;
    this.loadTransactions(user.id);
  }

  private loadTransactions(userId: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.transactions.set([]);

    this.transactionService.getByUser(userId).subscribe({
      next: (data) => {
        this.transactions.set(data);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Impossible de charger les transactions.');
        this.loading.set(false);
      },
    });
  }

  formatCurrency(value: number): string {
    return new Intl.NumberFormat('fr-FR').format(value) + ' FCFA';
  }

  formatDate(dateString: string): string {
    return new Date(dateString).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
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

  directionLabel(transaction: Transaction): 'ENTREE' | 'SORTIE' | 'NEUTRE' {
    const userId = this.currentUser()?.id;
    if (!userId) return 'NEUTRE';
    if (transaction.receiverId === userId) return 'ENTREE';
    if (transaction.senderId === userId) return 'SORTIE';
    return 'NEUTRE';
  }

  directionClass(transaction: Transaction): string {
    const dir = this.directionLabel(transaction);
    if (dir === 'ENTREE') return 'amount-in';
    if (dir === 'SORTIE') return 'amount-out';
    return 'amount-neutral';
  }

  directionSign(transaction: Transaction): string {
    const dir = this.directionLabel(transaction);
    if (dir === 'ENTREE') return '+';
    if (dir === 'SORTIE') return '-';
    return '';
  }
}
