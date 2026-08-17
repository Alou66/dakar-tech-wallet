import { Loan, LoanStatus } from '../models/loan.model';
import { Transaction, TransactionStatus, TransactionType } from '../models/transaction.model';
import { User, UserRole, UserStatus } from '../models/user.model';
import {
  computeAdminDashboardStats,
  computeFinancialVolume,
  computeGrantedLoansAmount,
} from './admin-dashboard-stats.util';

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'u1',
    firstName: 'Test',
    lastName: 'User',
    email: 'test@example.sn',
    phone: '+221770000000',
    accountNumber: 'ACC-0001',
    role: UserRole.CLIENT,
    status: UserStatus.ACTIVE,
    walletBalance: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeLoan(overrides: Partial<Loan> = {}): Loan {
  return {
    id: 'loan1',
    userId: 'u1',
    amount: 100000,
    interestRate: 5,
    durationMonths: 6,
    monthlyPayment: 17500,
    remainingBalance: 100000,
    status: LoanStatus.EN_ATTENTE,
    requestDate: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx1',
    type: TransactionType.DEPOT,
    status: TransactionStatus.REUSSIE,
    amount: 10000,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('computeAdminDashboardStats', () => {
  it('1. compte correctement les utilisateurs actifs', () => {
    const users = [
      makeUser({ id: 'u1', status: UserStatus.ACTIVE }),
      makeUser({ id: 'u2', status: UserStatus.ACTIVE }),
      makeUser({ id: 'u3', status: UserStatus.SUSPENDED }),
    ];

    const stats = computeAdminDashboardStats(users, [], []);

    expect(stats.activeUsers).toBe(2);
    expect(stats.totalUsers).toBe(3);
  });

  it('2. compte correctement les utilisateurs suspendus', () => {
    const users = [
      makeUser({ id: 'u1', status: UserStatus.SUSPENDED }),
      makeUser({ id: 'u2', status: UserStatus.ACTIVE }),
      makeUser({ id: 'u3', status: UserStatus.SUSPENDED }),
    ];

    const stats = computeAdminDashboardStats(users, [], []);

    expect(stats.suspendedUsers).toBe(2);
  });

  it('3. compte uniquement les transactions REUSSIE', () => {
    const transactions = [
      makeTransaction({ id: 'tx1', status: TransactionStatus.REUSSIE }),
      makeTransaction({ id: 'tx2', status: TransactionStatus.REUSSIE }),
      makeTransaction({ id: 'tx3', status: TransactionStatus.ECHOUEE }),
      makeTransaction({ id: 'tx4', status: TransactionStatus.EN_ATTENTE }),
      makeTransaction({ id: 'tx5', status: TransactionStatus.ANNULEE }),
    ];

    const stats = computeAdminDashboardStats([], [], transactions);

    expect(stats.successfulTransactionsCount).toBe(2);
  });

  it("4. calcule le volume financier en ne comptant qu'une fois chaque virement (senderId + receiverId sur la même ligne)", () => {
    const transactions = [
      makeTransaction({ id: 'tx1', type: TransactionType.DEPOT, amount: 100000, receiverId: 'u2' }),
      makeTransaction({
        id: 'tx2',
        type: TransactionType.VIREMENT,
        amount: 15000,
        senderId: 'u2',
        receiverId: 'u3',
      }),
      makeTransaction({ id: 'tx3', type: TransactionType.RETRAIT, amount: 20000, senderId: 'u3' }),
      makeTransaction({
        id: 'tx4',
        type: TransactionType.RETRAIT,
        status: TransactionStatus.ECHOUEE,
        amount: 999999,
        senderId: 'u2',
      }),
    ];

    expect(computeFinancialVolume(transactions)).toBe(100000 + 15000 + 20000);
  });

  it('5.1 compte les prêts par statut', () => {
    const loans = [
      makeLoan({ id: 'l1', status: LoanStatus.EN_ATTENTE }),
      makeLoan({ id: 'l2', status: LoanStatus.EN_ATTENTE }),
      makeLoan({ id: 'l3', status: LoanStatus.EN_COURS }),
      makeLoan({ id: 'l4', status: LoanStatus.EN_RETARD }),
      makeLoan({ id: 'l5', status: LoanStatus.REMBOURSE }),
      makeLoan({ id: 'l6', status: LoanStatus.APPROUVE }),
      makeLoan({ id: 'l7', status: LoanStatus.REJETE }),
    ];

    const stats = computeAdminDashboardStats([], loans, []);

    expect(stats.totalLoans).toBe(7);
    expect(stats.pendingLoans).toBe(2);
    expect(stats.ongoingLoans).toBe(1);
    expect(stats.lateLoans).toBe(1);
    expect(stats.repaidLoans).toBe(1);
  });

  it("5.2 n'inclut ni les prêts en attente ni les prêts rejetés dans le montant accordé", () => {
    const loans = [
      makeLoan({ id: 'l1', status: LoanStatus.EN_ATTENTE, amount: 500000 }),
      makeLoan({ id: 'l2', status: LoanStatus.REJETE, amount: 300000 }),
    ];

    expect(computeGrantedLoansAmount(loans)).toBe(0);
  });

  it('6. calcule le montant total des prêts accordés (APPROUVE + EN_COURS + EN_RETARD + REMBOURSE)', () => {
    const loans = [
      makeLoan({ id: 'l1', status: LoanStatus.EN_ATTENTE, amount: 500000 }),
      makeLoan({ id: 'l2', status: LoanStatus.REJETE, amount: 300000 }),
      makeLoan({ id: 'l3', status: LoanStatus.APPROUVE, amount: 80000 }),
      makeLoan({ id: 'l4', status: LoanStatus.EN_COURS, amount: 200000 }),
      makeLoan({ id: 'l5', status: LoanStatus.EN_RETARD, amount: 300000 }),
      makeLoan({ id: 'l6', status: LoanStatus.REMBOURSE, amount: 150000 }),
    ];

    const stats = computeAdminDashboardStats([], loans, []);

    expect(stats.grantedLoansAmount).toBe(80000 + 200000 + 300000 + 150000);
  });

  it('gère des listes vides sans erreur', () => {
    const stats = computeAdminDashboardStats([], [], []);

    expect(stats).toEqual({
      totalUsers: 0,
      activeUsers: 0,
      suspendedUsers: 0,
      financialVolume: 0,
      totalLoans: 0,
      pendingLoans: 0,
      ongoingLoans: 0,
      lateLoans: 0,
      repaidLoans: 0,
      grantedLoansAmount: 0,
      successfulTransactionsCount: 0,
    });
  });
});
