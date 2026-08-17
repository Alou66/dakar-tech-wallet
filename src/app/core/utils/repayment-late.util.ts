import { Repayment, RepaymentStatus } from '../models/repayment.model';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface OverdueRepaymentUpdate {
  id: string;
  daysLate: number;
}

/**
 * Nombre de jours écoulés entre une date d'échéance et une date de référence
 * (aujourd'hui par défaut). Retourne 0 tant que l'échéance n'est pas dépassée.
 */
export function computeDaysLate(dueDate: string, now: Date = new Date()): number {
  const diff = now.getTime() - new Date(dueDate).getTime();
  return diff > 0 ? Math.floor(diff / MS_PER_DAY) : 0;
}

/**
 * Une échéance est considérée en retard uniquement si elle est encore
 * PLANIFIE et que sa date d'échéance est dépassée. Une échéance déjà PAYE
 * (ou tout autre statut) n'est jamais reclassée.
 */
export function isRepaymentOverdue(repayment: Repayment, now: Date = new Date()): boolean {
  return repayment.status === RepaymentStatus.PLANIFIE && computeDaysLate(repayment.dueDate, now) > 0;
}

/**
 * Détecte, parmi une liste d'échéances, celles qui doivent basculer de
 * PLANIFIE vers EN_RETARD, avec leur nombre de jours de retard.
 */
export function detectOverdueRepayments(
  repayments: Repayment[],
  now: Date = new Date(),
): OverdueRepaymentUpdate[] {
  return repayments
    .filter((repayment) => isRepaymentOverdue(repayment, now))
    .map((repayment) => ({ id: repayment.id, daysLate: computeDaysLate(repayment.dueDate, now) }));
}

/** Taux forfaitaire de la pénalité de retard, appliqué au montant dû de l'échéance. */
export const LATE_FEE_RATE = 0.05;

/**
 * Pénalité monétaire due lorsqu'une échéance bascule en retard, calculée une
 * seule fois au moment de la transition PLANIFIE -> EN_RETARD (voir
 * `RepaymentService.syncOverdueStatuses`, qui ne retraite jamais une
 * échéance déjà EN_RETARD) afin de ne jamais compter deux fois la même
 * pénalité.
 */
export function computeLateFee(amountDue: number): number {
  return Math.round(amountDue * LATE_FEE_RATE);
}
