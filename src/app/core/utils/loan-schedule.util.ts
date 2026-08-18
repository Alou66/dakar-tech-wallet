import { Loan } from '../models/loan.model';

/**
 * Total réellement dû sur toute la durée du prêt (capital + intérêts).
 * L'échéancier lui-même est désormais généré côté serveur (voir
 * `LoanScheduleCalculator` côté backend) ; cette fonction ne sert plus ici
 * qu'à l'aperçu affiché dans le formulaire de demande de prêt.
 */
export function scheduleTotalDue(loan: Pick<Loan, 'monthlyPayment' | 'durationMonths'>): number {
  return loan.monthlyPayment * loan.durationMonths;
}
