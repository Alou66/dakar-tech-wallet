import { Repayment, RepaymentStatus } from '../models/repayment.model';
import {
  computeDaysLate,
  computeLateFee,
  detectOverdueRepayments,
  isRepaymentOverdue,
} from './repayment-late.util';

const NOW = new Date('2026-08-15T00:00:00.000Z');

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

describe('computeDaysLate', () => {
  it('retourne 0 quand la date est dans le futur', () => {
    expect(computeDaysLate('2026-09-01T00:00:00.000Z', NOW)).toBe(0);
  });

  it("retourne 0 le jour même de l'échéance", () => {
    expect(computeDaysLate('2026-08-15T00:00:00.000Z', NOW)).toBe(0);
  });

  it('calcule 1 jour de retard', () => {
    expect(computeDaysLate('2026-08-14T00:00:00.000Z', NOW)).toBe(1);
  });

  it('calcule un retard important', () => {
    expect(computeDaysLate('2026-06-01T00:00:00.000Z', NOW)).toBe(75);
  });
});

describe('isRepaymentOverdue', () => {
  it('est vrai pour une échéance PLANIFIE dépassée', () => {
    const repayment = makeRepayment({ status: RepaymentStatus.PLANIFIE, dueDate: '2026-08-14T00:00:00.000Z' });
    expect(isRepaymentOverdue(repayment, NOW)).toBe(true);
  });

  it("est faux pour une échéance PLANIFIE non encore échue (paiement à temps)", () => {
    const repayment = makeRepayment({ status: RepaymentStatus.PLANIFIE, dueDate: '2026-09-01T00:00:00.000Z' });
    expect(isRepaymentOverdue(repayment, NOW)).toBe(false);
  });

  it('ne modifie jamais une échéance déjà PAYE, même si sa date est dépassée', () => {
    const repayment = makeRepayment({
      status: RepaymentStatus.PAYE,
      dueDate: '2026-06-01T00:00:00.000Z',
      amountPaid: 10000,
      paymentDate: '2026-06-01T00:00:00.000Z',
    });
    expect(isRepaymentOverdue(repayment, NOW)).toBe(false);
  });

  it('ignore une échéance déjà EN_RETARD (pas de re-détection)', () => {
    const repayment = makeRepayment({ status: RepaymentStatus.EN_RETARD, dueDate: '2026-06-01T00:00:00.000Z' });
    expect(isRepaymentOverdue(repayment, NOW)).toBe(false);
  });
});

describe('detectOverdueRepayments', () => {
  it('client sans historique : aucune échéance à mettre à jour', () => {
    expect(detectOverdueRepayments([], NOW)).toEqual([]);
  });

  it('détecte plusieurs retards cumulés avec leur nombre de jours respectif', () => {
    const repayments = [
      makeRepayment({ id: 'rp1', dueDate: '2026-08-14T00:00:00.000Z' }),
      makeRepayment({ id: 'rp2', dueDate: '2026-06-01T00:00:00.000Z' }),
      makeRepayment({ id: 'rp3', status: RepaymentStatus.PAYE, dueDate: '2026-06-01T00:00:00.000Z' }),
      makeRepayment({ id: 'rp4', dueDate: '2026-09-01T00:00:00.000Z' }),
    ];

    expect(detectOverdueRepayments(repayments, NOW)).toEqual([
      { id: 'rp1', daysLate: 1 },
      { id: 'rp2', daysLate: 75 },
    ]);
  });
});

describe('computeLateFee', () => {
  it('calcule une pénalité proportionnelle au montant dû', () => {
    expect(computeLateFee(10000)).toBe(500);
  });

  it('arrondit le résultat', () => {
    expect(computeLateFee(10001)).toBe(500);
  });

  it('retourne 0 pour un montant dû nul', () => {
    expect(computeLateFee(0)).toBe(0);
  });
});
