import { Loan, LoanStatus } from '../models/loan.model';
import { Repayment, RepaymentStatus } from '../models/repayment.model';

/** Statuts pour lesquels le statut du prêt dépend de son échéancier (prêt décaissé, non soldé). */
const SCHEDULE_DEPENDENT_STATUSES: ReadonlySet<LoanStatus> = new Set([
  LoanStatus.EN_COURS,
  LoanStatus.EN_RETARD,
]);

function hasLateInstallment(repayments: Repayment[]): boolean {
  return repayments.some(
    (repayment) => repayment.status === RepaymentStatus.EN_RETARD || repayment.status === RepaymentStatus.IMPAYE,
  );
}

/**
 * Détermine le statut qu'un prêt devrait avoir au vu de son échéancier
 * actuel : EN_RETARD dès qu'au moins une échéance est EN_RETARD/IMPAYE,
 * EN_COURS sinon. Fonction pure et déterministe, uniquement basée sur
 * l'état fourni (jamais sur l'heure courante), ce qui la rend
 * naturellement idempotente : rappelée avec le même échéancier, elle
 * retourne toujours le même résultat.
 *
 * Ne s'applique qu'aux prêts décaissés et non soldés
 * ({@link SCHEDULE_DEPENDENT_STATUSES}) : un prêt EN_ATTENTE, APPROUVE,
 * REJETE ou REMBOURSE garde son statut, qui ne dépend jamais de
 * l'échéancier (un prêt soldé reste REMBOURSE même si une pénalité tardive
 * traîne encore sur une échéance).
 */
export function deriveLoanStatus(loan: Pick<Loan, 'status'>, repayments: Repayment[]): LoanStatus {
  if (!SCHEDULE_DEPENDENT_STATUSES.has(loan.status)) {
    return loan.status;
  }
  return hasLateInstallment(repayments) ? LoanStatus.EN_RETARD : LoanStatus.EN_COURS;
}
