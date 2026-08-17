import { Loan, LoanStatus } from '../models/loan.model';
import { Transaction, TransactionStatus } from '../models/transaction.model';
import { User, UserStatus } from '../models/user.model';

export interface AdminDashboardStats {
  totalUsers: number;
  activeUsers: number;
  suspendedUsers: number;
  financialVolume: number;
  totalLoans: number;
  pendingLoans: number;
  ongoingLoans: number;
  lateLoans: number;
  repaidLoans: number;
  grantedLoansAmount: number;
  successfulTransactionsCount: number;
}

/**
 * Statuts considérés comme "prêt accordé" : la demande a été validée par un
 * admin (APPROUVE), qu'elle soit ensuite décaissée (EN_COURS), en retard de
 * paiement (EN_RETARD) ou intégralement soldée (REMBOURSE). EN_ATTENTE
 * (pas encore décidé) et REJETE (refusé) ne comptent pas comme accordés.
 */
const GRANTED_LOAN_STATUSES: ReadonlySet<LoanStatus> = new Set([
  LoanStatus.APPROUVE,
  LoanStatus.EN_COURS,
  LoanStatus.EN_RETARD,
  LoanStatus.REMBOURSE,
]);

/**
 * Volume financier total = somme du champ `amount` de chaque transaction au
 * statut REUSSIE, tous types confondus (dépôt, retrait, virement,
 * décaissement et remboursement de prêt).
 *
 * Chaque opération financière n'existe qu'une seule fois dans la collection
 * `transactions` (une ligne = une opération, pas une ligne par compte
 * impacté : un virement u2 -> u3 est un seul enregistrement portant
 * senderId ET receiverId). Sommer `amount` sur les transactions REUSSIE ne
 * compte donc jamais deux fois la même opération.
 */
export function computeFinancialVolume(transactions: Transaction[]): number {
  return transactions
    .filter((transaction) => transaction.status === TransactionStatus.REUSSIE)
    .reduce((sum, transaction) => sum + transaction.amount, 0);
}

/** Montant total des prêts accordés (voir {@link GRANTED_LOAN_STATUSES}). */
export function computeGrantedLoansAmount(loans: Loan[]): number {
  return loans
    .filter((loan) => GRANTED_LOAN_STATUSES.has(loan.status))
    .reduce((sum, loan) => sum + loan.amount, 0);
}

/** Agrège toutes les statistiques globales du tableau de bord administrateur. */
export function computeAdminDashboardStats(
  users: User[],
  loans: Loan[],
  transactions: Transaction[],
): AdminDashboardStats {
  return {
    totalUsers: users.length,
    activeUsers: users.filter((user) => user.status === UserStatus.ACTIVE).length,
    suspendedUsers: users.filter((user) => user.status === UserStatus.SUSPENDED).length,
    financialVolume: computeFinancialVolume(transactions),
    totalLoans: loans.length,
    pendingLoans: loans.filter((loan) => loan.status === LoanStatus.EN_ATTENTE).length,
    ongoingLoans: loans.filter((loan) => loan.status === LoanStatus.EN_COURS).length,
    lateLoans: loans.filter((loan) => loan.status === LoanStatus.EN_RETARD).length,
    repaidLoans: loans.filter((loan) => loan.status === LoanStatus.REMBOURSE).length,
    grantedLoansAmount: computeGrantedLoansAmount(loans),
    successfulTransactionsCount: transactions.filter(
      (transaction) => transaction.status === TransactionStatus.REUSSIE,
    ).length,
  };
}
