import { Injectable, inject } from '@angular/core';
import { Observable, forkJoin, map } from 'rxjs';

import { CreditScore } from '../models/credit-score.model';
import { Loan, LoanStatus } from '../models/loan.model';
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

export interface AdminDashboardData {
  users: User[];
  loans: Loan[];
  transactions: Transaction[];
  totalUsers: number;
  totalActiveLoans: number;
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
    }).pipe(
      map(({ users, loans, transactions }) => ({
        users,
        loans,
        transactions,
        totalUsers: users.length,
        totalActiveLoans: loans.filter((loan) => loan.status === LoanStatus.EN_COURS).length,
      })),
    );
  }
}
