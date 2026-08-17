import { CreditScoreCategory } from '../models/credit-score.model';
import { Repayment, RepaymentStatus } from '../models/repayment.model';
import {
  BASE_SCORE,
  MAX_SCORE,
  MIN_SCORE,
  categoryForScore,
  computeCreditScore,
  computeLatePenalty,
} from './credit-score.util';

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

describe('computeCreditScore', () => {
  it('1. un paiement à temps améliore le score par rapport à la ligne de base', () => {
    const onTime = computeCreditScore(
      [makeRepayment({ status: RepaymentStatus.PAYE, dueDate: '2026-08-01T00:00:00.000Z', paymentDate: '2026-07-30T00:00:00.000Z' })],
      NOW,
    );
    const noHistory = computeCreditScore([], NOW);

    expect(onTime.score).toBeGreaterThan(noHistory.score);
    expect(onTime.onTimeCount).toBe(1);
    expect(onTime.lateCount).toBe(0);
    expect(onTime.totalDaysLate).toBe(0);
  });

  it('2. un retard de 1 jour diminue le score par rapport à la ligne de base', () => {
    const noHistory = computeCreditScore([], NOW);
    const oneDayLate = computeCreditScore(
      [makeRepayment({ status: RepaymentStatus.EN_RETARD, dueDate: '2026-08-14T00:00:00.000Z' })],
      NOW,
    );

    expect(oneDayLate.score).toBeLessThan(noHistory.score);
    expect(oneDayLate.lateCount).toBe(1);
    expect(oneDayLate.totalDaysLate).toBe(1);
  });

  it('3. un retard important pénalise davantage qu’un retard court', () => {
    const shortLate = computeCreditScore(
      [makeRepayment({ status: RepaymentStatus.EN_RETARD, dueDate: '2026-08-14T00:00:00.000Z' })],
      NOW,
    );
    const longLate = computeCreditScore(
      [makeRepayment({ status: RepaymentStatus.EN_RETARD, dueDate: '2026-05-01T00:00:00.000Z' })],
      NOW,
    );

    expect(longLate.score).toBeLessThan(shortLate.score);
    expect(longLate.totalDaysLate).toBeGreaterThan(shortLate.totalDaysLate);
  });

  it('4. plusieurs retards cumulés pénalisent davantage qu’un seul retard', () => {
    const singleLate = computeCreditScore(
      [makeRepayment({ id: 'rp1', status: RepaymentStatus.EN_RETARD, dueDate: '2026-08-05T00:00:00.000Z' })],
      NOW,
    );
    const multipleLate = computeCreditScore(
      [
        makeRepayment({ id: 'rp1', status: RepaymentStatus.EN_RETARD, dueDate: '2026-08-05T00:00:00.000Z' }),
        makeRepayment({ id: 'rp2', status: RepaymentStatus.EN_RETARD, dueDate: '2026-07-20T00:00:00.000Z' }),
        makeRepayment({ id: 'rp3', status: RepaymentStatus.EN_RETARD, dueDate: '2026-07-05T00:00:00.000Z' }),
      ],
      NOW,
    );

    expect(multipleLate.score).toBeLessThan(singleLate.score);
    expect(multipleLate.lateCount).toBe(3);
    expect(multipleLate.totalDaysLate).toBeGreaterThan(singleLate.totalDaysLate);
  });

  it('5. une échéance déjà PAYE à temps ne compte jamais comme un retard', () => {
    const breakdown = computeCreditScore(
      [
        makeRepayment({
          status: RepaymentStatus.PAYE,
          dueDate: '2026-06-01T00:00:00.000Z',
          paymentDate: '2026-06-01T00:00:00.000Z',
        }),
      ],
      NOW,
    );

    expect(breakdown.lateCount).toBe(0);
    expect(breakdown.onTimeCount).toBe(1);
  });

  it('6. un client sans historique obtient le score de base, sans erreur', () => {
    const breakdown = computeCreditScore([], NOW);

    expect(breakdown.score).toBe(BASE_SCORE);
    expect(breakdown.onTimeCount).toBe(0);
    expect(breakdown.lateCount).toBe(0);
    expect(breakdown.totalDaysLate).toBe(0);
    expect(breakdown.totalLoans).toBe(0);
  });

  it('7. le score est toujours compris entre 0 et 100, même avec un historique extrême', () => {
    const manyOnTime = Array.from({ length: 50 }, (_, i) =>
      makeRepayment({
        id: `on-time-${i}`,
        status: RepaymentStatus.PAYE,
        dueDate: '2026-01-01T00:00:00.000Z',
        paymentDate: '2026-01-01T00:00:00.000Z',
      }),
    );
    const manyLate = Array.from({ length: 50 }, (_, i) =>
      makeRepayment({ id: `late-${i}`, status: RepaymentStatus.EN_RETARD, dueDate: '2025-01-01T00:00:00.000Z' }),
    );

    expect(computeCreditScore(manyOnTime, NOW).score).toBeLessThanOrEqual(MAX_SCORE);
    expect(computeCreditScore(manyLate, NOW).score).toBeGreaterThanOrEqual(MIN_SCORE);
  });

  it('8. attribue correctement les 4 catégories selon les seuils', () => {
    expect(categoryForScore(100)).toBe(CreditScoreCategory.EXCELLENT);
    expect(categoryForScore(80)).toBe(CreditScoreCategory.EXCELLENT);
    expect(categoryForScore(79)).toBe(CreditScoreCategory.BON);
    expect(categoryForScore(60)).toBe(CreditScoreCategory.BON);
    expect(categoryForScore(59)).toBe(CreditScoreCategory.A_RISQUE);
    expect(categoryForScore(35)).toBe(CreditScoreCategory.A_RISQUE);
    expect(categoryForScore(34)).toBe(CreditScoreCategory.MAUVAIS_PAYEUR);
    expect(categoryForScore(0)).toBe(CreditScoreCategory.MAUVAIS_PAYEUR);
  });

  it('9. le score est recalculé après la modification d’un remboursement (ex : passage à PAYE)', () => {
    const beforePayment = [makeRepayment({ status: RepaymentStatus.EN_RETARD, dueDate: '2026-06-01T00:00:00.000Z' })];
    const afterPayment = [
      makeRepayment({
        status: RepaymentStatus.PAYE,
        dueDate: '2026-06-01T00:00:00.000Z',
        paymentDate: '2026-06-01T00:00:00.000Z',
      }),
    ];

    const before = computeCreditScore(beforePayment, NOW);
    const after = computeCreditScore(afterPayment, NOW);

    expect(after.score).not.toBe(before.score);
    expect(after.score).toBeGreaterThan(before.score);
  });
});

describe('computeLatePenalty', () => {
  it('ne pénalise pas une échéance non en retard', () => {
    expect(computeLatePenalty(0)).toBe(0);
  });

  it('applique une pénalité croissante avec le nombre de jours', () => {
    const p1 = computeLatePenalty(1);
    const p10 = computeLatePenalty(10);
    const p60 = computeLatePenalty(60);

    expect(p10).toBeGreaterThan(p1);
    expect(p60).toBeGreaterThan(p10);
  });

  it('plafonne la pénalité pour les retards extrêmes', () => {
    expect(computeLatePenalty(1000)).toBe(computeLatePenalty(200));
  });
});
