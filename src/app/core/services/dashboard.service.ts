import { Injectable, inject } from '@angular/core';
import { Observable, forkJoin } from 'rxjs';

import { CreditScore } from '../models/credit-score.model';
import { Loan } from '../models/loan.model';
import { Transaction } from '../models/transaction.model';
import { User } from '../models/user.model';
import { CreditScoreService } from './credit-score.service';
import { LoanService } from './loan.service';
import { TransactionService } from './transaction.service';
import { UserService } from './user.service';

export interface ClientDashboardData {
  user: User;
  recentTransactions: Transaction[];
  loans: Loan[];
  creditScore?: CreditScore;
}

/**
 * Données brutes du tableau de bord administrateur. Les statistiques
 * dérivées (comptages, volumes...) se calculent côté composant via
 * `computed()`, à partir de ces collections — voir `computeAdminDashboardStats`.
 */
export interface AdminDashboardData {
  users: User[];
  loans: Loan[];
  transactions: Transaction[];
}

/** Données brutes pour la gestion des utilisateurs (`/admin/users`). */
export interface AdminUsersManagementData {
  users: User[];
  creditScores: CreditScore[];
}

/** Données brutes pour la gestion des transactions (`/admin/transactions`). */
export interface AdminTransactionsManagementData {
  transactions: Transaction[];
  users: User[];
}

/** Données brutes pour la gestion des prêts (`/admin/loans`). */
export interface AdminLoansManagementData {
  loans: Loan[];
  users: User[];
  creditScores: CreditScore[];
}

@Injectable({ providedIn: 'root' })
export class DashboardService {
  private readonly userService = inject(UserService);
  private readonly transactionService = inject(TransactionService);
  private readonly loanService = inject(LoanService);
  private readonly creditScoreService = inject(CreditScoreService);

  getClientDashboard(userId: string): Observable<ClientDashboardData> {
    return forkJoin({
      user: this.userService.getById(userId),
      recentTransactions: this.transactionService.getByUser(userId),
      loans: this.loanService.getByUser(userId),
      creditScore: this.creditScoreService.getByUser(userId),
    });
  }

  getAdminDashboard(): Observable<AdminDashboardData> {
    return forkJoin({
      users: this.userService.getAll(),
      loans: this.loanService.getAll(),
      transactions: this.transactionService.getAll(),
    });
  }

  /** Les scores de solvabilité sont désormais lus directement, déjà tenus à jour côté serveur. */
  getAdminUsersManagement(): Observable<AdminUsersManagementData> {
    return forkJoin({
      users: this.userService.getAll(),
      creditScores: this.creditScoreService.getAll(),
    });
  }

  getAdminTransactionsManagement(): Observable<AdminTransactionsManagementData> {
    return forkJoin({
      transactions: this.transactionService.getAll(),
      users: this.userService.getAll(),
    });
  }

  getAdminLoansManagement(): Observable<AdminLoansManagementData> {
    return forkJoin({
      loans: this.loanService.getAll(),
      users: this.userService.getAll(),
      creditScores: this.creditScoreService.getAll(),
    });
  }
}
