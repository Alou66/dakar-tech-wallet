import { Injectable, inject } from '@angular/core';
import { Observable, forkJoin, map } from 'rxjs';

import { CreditScore } from '../models/credit-score.model';
import { Loan } from '../models/loan.model';
import { Repayment } from '../models/repayment.model';
import { Transaction } from '../models/transaction.model';
import { User } from '../models/user.model';
import { computeCreditScore } from '../utils/credit-score.util';
import { CreditScoreService } from './credit-score.service';
import { LoanService } from './loan.service';
import { RepaymentService } from './repayment.service';
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
  private readonly repaymentService = inject(RepaymentService);

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

  /**
   * Le score de solvabilité affiché côté Admin est toujours recalculé à
   * partir de l'historique réel des remboursements (`computeCreditScore`,
   * la même fonction que côté client), jamais lu depuis la dernière valeur
   * persistée dans `/creditScores` qui peut être périmée.
   */
  getAdminUsersManagement(): Observable<AdminUsersManagementData> {
    return forkJoin({
      users: this.userService.getAll(),
      repayments: this.repaymentService.getAll(),
    }).pipe(
      map(({ users, repayments }) => ({
        users,
        creditScores: this.computeLiveCreditScores(users, repayments),
      })),
    );
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
      repayments: this.repaymentService.getAll(),
    }).pipe(
      map(({ loans, users, repayments }) => ({
        loans,
        users,
        creditScores: this.computeLiveCreditScores(users, repayments),
      })),
    );
  }

  private computeLiveCreditScores(users: User[], repayments: Repayment[]): CreditScore[] {
    const repaymentsByUser = new Map<string, Repayment[]>();
    for (const repayment of repayments) {
      const existing = repaymentsByUser.get(repayment.userId) ?? [];
      existing.push(repayment);
      repaymentsByUser.set(repayment.userId, existing);
    }

    const calculatedAt = new Date().toISOString();
    return users.map((user) => {
      const breakdown = computeCreditScore(repaymentsByUser.get(user.id) ?? []);
      return {
        id: `live-${user.id}`,
        userId: user.id,
        score: breakdown.score,
        category: breakdown.category,
        totalLoans: breakdown.totalLoans,
        onTimeRepayments: breakdown.onTimeCount,
        lateRepayments: breakdown.lateCount,
        calculatedAt,
      };
    });
  }
}
