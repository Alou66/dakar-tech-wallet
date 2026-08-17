import { Loan } from '../models/loan.model';
import { Repayment, RepaymentStatus } from '../models/repayment.model';

/** Total réellement dû sur toute la durée du prêt (capital + intérêts), base de l'échéancier et de `remainingBalance`. */
export function scheduleTotalDue(loan: Pick<Loan, 'monthlyPayment' | 'durationMonths'>): number {
  return loan.monthlyPayment * loan.durationMonths;
}

/**
 * Génère l'échéancier d'un prêt décaissé : une échéance PLANIFIE par mois de
 * `durationMonths`, avec des dates d'échéance espacées d'un mois à partir de
 * `startDate`. Le montant dû de chaque échéance est la mensualité, à
 * l'exception de la dernière qui absorbe l'écart d'arrondi pour que la somme
 * des échéances corresponde exactement à {@link scheduleTotalDue}.
 */
export function generateInstallments(
  loan: Pick<Loan, 'id' | 'userId' | 'monthlyPayment' | 'durationMonths'>,
  startDate: Date,
): Omit<Repayment, 'id'>[] {
  const totalDue = scheduleTotalDue(loan);
  const installments: Omit<Repayment, 'id'>[] = [];
  let allocated = 0;

  for (let installmentNumber = 1; installmentNumber <= loan.durationMonths; installmentNumber++) {
    const dueDate = new Date(startDate);
    dueDate.setMonth(dueDate.getMonth() + installmentNumber);

    const isLast = installmentNumber === loan.durationMonths;
    const amountDue = isLast ? totalDue - allocated : loan.monthlyPayment;
    allocated += amountDue;

    installments.push({
      loanId: loan.id,
      userId: loan.userId,
      installmentNumber,
      dueDate: dueDate.toISOString(),
      amountDue,
      status: RepaymentStatus.PLANIFIE,
    });
  }

  return installments;
}
