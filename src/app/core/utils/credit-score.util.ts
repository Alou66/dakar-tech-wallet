import { CreditScoreCategory } from '../models/credit-score.model';
import { Repayment, RepaymentStatus } from '../models/repayment.model';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Formule du score de solvabilité (déterministe, bornée entre 0 et 100) :
 *
 *   score = clamp(
 *     BASE_SCORE
 *       + onTimeCount * ON_TIME_BONUS
 *       - somme( latePenalty(joursDeRetard) pour chaque échéance en retard ),
 *     0, 100
 *   )
 *
 *   latePenalty(jours) = min(MAX_LATE_PENALTY, LATE_BASE_PENALTY + jours * LATE_PENALTY_PER_DAY)
 *
 * Une échéance est considérée "en retard" si :
 *   - elle est EN_RETARD ou IMPAYE : le retard est calculé jusqu'à `now` ;
 *   - ou PAYE mais réglée après sa date d'échéance : le retard est calculé
 *     jusqu'à la date de paiement effective.
 * Une échéance PLANIFIE non échue, ou PAYE à temps, n'a aucun impact.
 *
 * La pénalité par échéance croît avec le nombre de jours de retard (jusqu'à
 * un plafond) et plusieurs retards s'additionnent : l'impact est donc
 * cumulatif.
 */
export const BASE_SCORE = 60;
export const ON_TIME_BONUS = 4;
export const LATE_BASE_PENALTY = 5;
export const LATE_PENALTY_PER_DAY = 1;
export const MAX_LATE_PENALTY = 30;
export const MIN_SCORE = 0;
export const MAX_SCORE = 100;

/** Seuils (bornes inférieures incluses) des catégories de solvabilité. */
export const CREDIT_SCORE_THRESHOLDS = {
  EXCELLENT: 80,
  BON: 60,
  A_RISQUE: 35,
} as const;

export interface CreditScoreBreakdown {
  score: number;
  category: CreditScoreCategory;
  onTimeCount: number;
  lateCount: number;
  totalDaysLate: number;
  totalLoans: number;
}

/** Pénalité infligée par une échéance en retard, en fonction de son nombre de jours de retard. */
export function computeLatePenalty(daysLate: number): number {
  if (daysLate <= 0) return 0;
  return Math.min(MAX_LATE_PENALTY, LATE_BASE_PENALTY + daysLate * LATE_PENALTY_PER_DAY);
}

/** Catégorie associée à un score, selon les seuils {@link CREDIT_SCORE_THRESHOLDS}. */
export function categoryForScore(score: number): CreditScoreCategory {
  if (score >= CREDIT_SCORE_THRESHOLDS.EXCELLENT) return CreditScoreCategory.EXCELLENT;
  if (score >= CREDIT_SCORE_THRESHOLDS.BON) return CreditScoreCategory.BON;
  if (score >= CREDIT_SCORE_THRESHOLDS.A_RISQUE) return CreditScoreCategory.A_RISQUE;
  return CreditScoreCategory.MAUVAIS_PAYEUR;
}

/**
 * Calcule le score de solvabilité et son détail à partir de l'historique
 * complet des remboursements du client. Fonction pure, sans effet de bord :
 * elle ne modifie ni ne suppose aucun statut, elle se contente de lire
 * l'historique fourni.
 */
export function computeCreditScore(repayments: Repayment[], now: Date = new Date()): CreditScoreBreakdown {
  let onTimeCount = 0;
  let lateCount = 0;
  let totalDaysLate = 0;
  let totalPenalty = 0;
  const loanIds = new Set<string>();

  for (const repayment of repayments) {
    loanIds.add(repayment.loanId);

    if (repayment.status === RepaymentStatus.PAYE) {
      const daysLate = repayment.paymentDate ? daysBetween(repayment.dueDate, repayment.paymentDate) : 0;
      if (daysLate > 0) {
        lateCount += 1;
        totalDaysLate += daysLate;
        totalPenalty += computeLatePenalty(daysLate);
      } else {
        onTimeCount += 1;
      }
      continue;
    }

    if (repayment.status === RepaymentStatus.EN_RETARD || repayment.status === RepaymentStatus.IMPAYE) {
      const daysLate = Math.max(1, daysBetween(repayment.dueDate, now.toISOString()));
      lateCount += 1;
      totalDaysLate += daysLate;
      totalPenalty += computeLatePenalty(daysLate);
    }
    // PLANIFIE non échue : aucun impact sur le score.
  }

  const rawScore = BASE_SCORE + onTimeCount * ON_TIME_BONUS - totalPenalty;
  const score = Math.round(clamp(rawScore, MIN_SCORE, MAX_SCORE));

  return {
    score,
    category: categoryForScore(score),
    onTimeCount,
    lateCount,
    totalDaysLate,
    totalLoans: loanIds.size,
  };
}

function daysBetween(fromIso: string, toIso: string): number {
  const diff = new Date(toIso).getTime() - new Date(fromIso).getTime();
  return Math.floor(diff / MS_PER_DAY);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Libellé français d'une catégorie de solvabilité, pour l'affichage. */
export function creditScoreCategoryLabel(category: CreditScoreCategory): string {
  switch (category) {
    case CreditScoreCategory.EXCELLENT:
      return 'Excellent';
    case CreditScoreCategory.BON:
      return 'Bon';
    case CreditScoreCategory.A_RISQUE:
      return 'À risque';
    case CreditScoreCategory.MAUVAIS_PAYEUR:
      return 'Mauvais payeur';
    default:
      return category;
  }
}

/** Classe CSS associée à une catégorie de solvabilité, pour l'affichage. */
export function creditScoreCategoryClass(category: CreditScoreCategory): string {
  switch (category) {
    case CreditScoreCategory.EXCELLENT:
      return 'score-excellent';
    case CreditScoreCategory.BON:
      return 'score-good';
    case CreditScoreCategory.A_RISQUE:
      return 'score-warning';
    case CreditScoreCategory.MAUVAIS_PAYEUR:
      return 'score-danger';
    default:
      return 'score-neutral';
  }
}
