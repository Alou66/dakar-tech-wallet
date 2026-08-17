import { RepaymentStatus } from '../models/repayment.model';
import { generateInstallments, scheduleTotalDue } from './loan-schedule.util';

const LOAN = {
  id: 'loan1',
  userId: 'u1',
  monthlyPayment: 52500,
  durationMonths: 4,
};

describe('scheduleTotalDue', () => {
  it('multiplie la mensualité par la durée', () => {
    expect(scheduleTotalDue(LOAN)).toBe(210000);
  });
});

describe('generateInstallments', () => {
  it('génère une échéance PLANIFIE par mois de durée', () => {
    const installments = generateInstallments(LOAN, new Date('2026-01-15T10:00:00.000Z'));

    expect(installments).toHaveLength(4);
    expect(installments.every((i) => i.status === RepaymentStatus.PLANIFIE)).toBe(true);
    expect(installments.map((i) => i.installmentNumber)).toEqual([1, 2, 3, 4]);
    expect(installments.every((i) => i.loanId === LOAN.id && i.userId === LOAN.userId)).toBe(true);
  });

  it('espace les dates d\'échéance d\'un mois à partir de la date de départ', () => {
    const installments = generateInstallments(LOAN, new Date('2026-01-15T10:00:00.000Z'));

    expect(installments.map((i) => i.dueDate)).toEqual([
      '2026-02-15T10:00:00.000Z',
      '2026-03-15T10:00:00.000Z',
      '2026-04-15T10:00:00.000Z',
      '2026-05-15T10:00:00.000Z',
    ]);
  });

  it('répartit la mensualité sur chaque échéance et fait absorber l\'écart d\'arrondi par la dernière', () => {
    const oddLoan = { id: 'loan2', userId: 'u2', monthlyPayment: 33333, durationMonths: 3 };
    const installments = generateInstallments(oddLoan, new Date('2026-01-01T00:00:00.000Z'));

    expect(installments[0].amountDue).toBe(33333);
    expect(installments[1].amountDue).toBe(33333);
    const total = installments.reduce((sum, i) => sum + i.amountDue, 0);
    expect(total).toBe(scheduleTotalDue(oddLoan));
  });
});
