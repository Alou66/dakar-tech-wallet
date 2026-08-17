import { Loan, LoanStatus } from '../models/loan.model';
import { Repayment, RepaymentStatus } from '../models/repayment.model';
import { deriveLoanStatus } from './loan-status.util';

function makeRepayment(overrides: Partial<Repayment> = {}): Repayment {
  return {
    id: 'rp1',
    loanId: 'loan1',
    userId: 'u1',
    installmentNumber: 1,
    dueDate: '2026-08-01T00:00:00.000Z',
    amountDue: 10000,
    status: RepaymentStatus.PLANIFIE,
    ...overrides,
  };
}

describe('deriveLoanStatus', () => {
  it("1. fait basculer un prêt EN_COURS en EN_RETARD dès qu'une échéance est EN_RETARD", () => {
    const loan: Pick<Loan, 'status'> = { status: LoanStatus.EN_COURS };
    const repayments = [
      makeRepayment({ id: 'rp1', status: RepaymentStatus.PAYE }),
      makeRepayment({ id: 'rp2', status: RepaymentStatus.EN_RETARD }),
    ];

    expect(deriveLoanStatus(loan, repayments)).toBe(LoanStatus.EN_RETARD);
  });

  it("2. fait basculer un prêt EN_COURS en EN_RETARD dès qu'une échéance est IMPAYE", () => {
    const loan: Pick<Loan, 'status'> = { status: LoanStatus.EN_COURS };
    const repayments = [makeRepayment({ status: RepaymentStatus.IMPAYE })];

    expect(deriveLoanStatus(loan, repayments)).toBe(LoanStatus.EN_RETARD);
  });

  it('3. fait revenir un prêt EN_RETARD à EN_COURS une fois toutes les échéances régularisées', () => {
    const loan: Pick<Loan, 'status'> = { status: LoanStatus.EN_RETARD };
    const repayments = [
      makeRepayment({ id: 'rp1', status: RepaymentStatus.PAYE }),
      makeRepayment({ id: 'rp2', status: RepaymentStatus.PLANIFIE, dueDate: '2999-01-01T00:00:00.000Z' }),
    ];

    expect(deriveLoanStatus(loan, repayments)).toBe(LoanStatus.EN_COURS);
  });

  it('4. est idempotent : rappelé avec le même échéancier, retourne toujours le même statut', () => {
    const loan: Pick<Loan, 'status'> = { status: LoanStatus.EN_COURS };
    const repayments = [makeRepayment({ status: RepaymentStatus.EN_RETARD })];

    const first = deriveLoanStatus(loan, repayments);
    const second = deriveLoanStatus({ status: first }, repayments);

    expect(first).toBe(LoanStatus.EN_RETARD);
    expect(second).toBe(LoanStatus.EN_RETARD);
  });

  it("5. ne touche jamais un prêt EN_ATTENTE, APPROUVE, REJETE ou REMBOURSE, même avec des échéances en retard", () => {
    const repayments = [makeRepayment({ status: RepaymentStatus.EN_RETARD })];

    for (const status of [
      LoanStatus.EN_ATTENTE,
      LoanStatus.APPROUVE,
      LoanStatus.REJETE,
      LoanStatus.REMBOURSE,
    ]) {
      expect(deriveLoanStatus({ status }, repayments)).toBe(status);
    }
  });

  it('6. laisse un prêt EN_COURS inchangé quand aucune échéance ne dépend du retard (planifiées à venir uniquement)', () => {
    const loan: Pick<Loan, 'status'> = { status: LoanStatus.EN_COURS };
    const repayments = [makeRepayment({ status: RepaymentStatus.PLANIFIE, dueDate: '2999-01-01T00:00:00.000Z' })];

    expect(deriveLoanStatus(loan, repayments)).toBe(LoanStatus.EN_COURS);
  });
});
