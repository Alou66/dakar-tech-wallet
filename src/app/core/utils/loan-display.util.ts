import { Loan, LoanStatus } from '../models/loan.model';
import { Repayment, RepaymentStatus } from '../models/repayment.model';
import { User, UserStatus } from '../models/user.model';
import { computeDaysLate } from './repayment-late.util';

/** Formatage monétaire commun aux pages "Prêts" (liste, détail, nouvelle demande). */
export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('fr-FR').format(value) + ' FCFA';
}

export function formatDate(dateString?: string): string {
  if (!dateString) return '—';
  return new Date(dateString).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/** Un prêt n'est ouvert au remboursement que décaissé (EN_COURS/EN_RETARD) et non soldé. */
export function isRepayableLoan(loan: Pick<Loan, 'status' | 'remainingBalance'>): boolean {
  return (
    (loan.status === LoanStatus.EN_COURS || loan.status === LoanStatus.EN_RETARD) &&
    loan.remainingBalance > 0
  );
}

/** Un compte suspendu ne peut pas demander de nouveau prêt (seule règle d'éligibilité actuellement en vigueur). */
export function isEligibleForLoanRequest(user: Pick<User, 'status'>): boolean {
  return user.status !== UserStatus.SUSPENDED;
}

/** Montant réellement accordé : uniquement pertinent une fois le prêt validé (ou soldé). */
export function grantedLoanAmount(loan: Loan): number | null {
  const grantedStatuses: LoanStatus[] = [
    LoanStatus.APPROUVE,
    LoanStatus.EN_COURS,
    LoanStatus.EN_RETARD,
    LoanStatus.REMBOURSE,
  ];
  return grantedStatuses.includes(loan.status) ? loan.amount : null;
}

export function loanStatusLabel(status: LoanStatus): string {
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

export function loanStatusClass(status: LoanStatus): string {
  switch (status) {
    case LoanStatus.EN_ATTENTE:
      return 'badge-pending';
    case LoanStatus.APPROUVE:
      return 'badge-approved';
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

export function repaymentStatusLabel(status: RepaymentStatus): string {
  switch (status) {
    case RepaymentStatus.PLANIFIE:
      return 'Planifié';
    case RepaymentStatus.PAYE:
      return 'Payé';
    case RepaymentStatus.EN_RETARD:
      return 'En retard';
    case RepaymentStatus.IMPAYE:
      return 'Impayé';
    default:
      return status;
  }
}

export function repaymentStatusClass(status: RepaymentStatus): string {
  switch (status) {
    case RepaymentStatus.PLANIFIE:
      return 'badge-neutral';
    case RepaymentStatus.PAYE:
      return 'badge-success';
    case RepaymentStatus.EN_RETARD:
      return 'badge-danger';
    case RepaymentStatus.IMPAYE:
      return 'badge-impaye';
    default:
      return 'badge-neutral';
  }
}

export function isLateRepayment(repayment: Repayment): boolean {
  return repayment.status === RepaymentStatus.EN_RETARD || repayment.status === RepaymentStatus.IMPAYE;
}

/** Nombre de jours de retard à afficher pour une échéance, null si elle n'est pas en retard. */
export function daysLateForRepayment(repayment: Repayment): number | null {
  if (repayment.status !== RepaymentStatus.EN_RETARD && repayment.status !== RepaymentStatus.IMPAYE) {
    return null;
  }
  const days = computeDaysLate(repayment.dueDate);
  return days > 0 ? days : null;
}
