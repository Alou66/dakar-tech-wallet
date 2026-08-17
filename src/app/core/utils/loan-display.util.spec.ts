import { Loan, LoanStatus } from '../models/loan.model';
import { Repayment, RepaymentStatus } from '../models/repayment.model';
import {
  daysLateForRepayment,
  formatCurrency,
  formatDate,
  grantedLoanAmount,
  isLateRepayment,
  isRepayableLoan,
  loanStatusClass,
  loanStatusLabel,
  repaymentStatusClass,
  repaymentStatusLabel,
} from './loan-display.util';

function makeLoan(overrides: Partial<Loan> = {}): Loan {
  return {
    id: 'loan1',
    userId: 'u1',
    amount: 100000,
    interestRate: 5,
    durationMonths: 4,
    monthlyPayment: 26250,
    remainingBalance: 52500,
    status: LoanStatus.EN_COURS,
    requestDate: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

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

describe('formatCurrency', () => {
  it('formate un montant avec le suffixe FCFA', () => {
    const formatted = formatCurrency(150000);
    expect(formatted.endsWith('FCFA')).toBe(true);
    expect(formatted.replace(/\s/g, '')).toBe('150000FCFA');
  });
});

describe('formatDate', () => {
  it('retourne un tiret si aucune date', () => {
    expect(formatDate(undefined)).toBe('—');
  });

  it('formate une date en jj/mm/aaaa', () => {
    expect(formatDate('2026-01-05T00:00:00.000Z')).toBe('05/01/2026');
  });
});

describe('isRepayableLoan', () => {
  it('est remboursable si EN_COURS avec un solde restant', () => {
    expect(isRepayableLoan({ status: LoanStatus.EN_COURS, remainingBalance: 1000 })).toBe(true);
  });

  it('est remboursable si EN_RETARD avec un solde restant', () => {
    expect(isRepayableLoan({ status: LoanStatus.EN_RETARD, remainingBalance: 1000 })).toBe(true);
  });

  it("n'est pas remboursable si soldé", () => {
    expect(isRepayableLoan({ status: LoanStatus.EN_COURS, remainingBalance: 0 })).toBe(false);
  });

  it("n'est pas remboursable si en attente", () => {
    expect(isRepayableLoan({ status: LoanStatus.EN_ATTENTE, remainingBalance: 1000 })).toBe(false);
  });
});

describe('grantedLoanAmount', () => {
  it("retourne null si la demande n'est pas encore validée", () => {
    expect(grantedLoanAmount(makeLoan({ status: LoanStatus.EN_ATTENTE }))).toBeNull();
  });

  it('retourne le montant si approuvé', () => {
    expect(grantedLoanAmount(makeLoan({ status: LoanStatus.APPROUVE }))).toBe(100000);
  });

  it('retourne le montant si remboursé', () => {
    expect(grantedLoanAmount(makeLoan({ status: LoanStatus.REMBOURSE }))).toBe(100000);
  });
});

describe('loanStatusLabel / loanStatusClass', () => {
  it('couvre tous les statuts de prêt avec un libellé et une classe dédiés', () => {
    for (const status of Object.values(LoanStatus)) {
      expect(loanStatusLabel(status)).not.toBe(status);
      expect(loanStatusClass(status)).toContain('badge-');
    }
  });
});

describe('repaymentStatusLabel / repaymentStatusClass', () => {
  it('couvre tous les statuts d’échéance avec un libellé et une classe dédiés', () => {
    for (const status of Object.values(RepaymentStatus)) {
      expect(repaymentStatusLabel(status)).not.toBe(status);
      expect(repaymentStatusClass(status)).toContain('badge-');
    }
  });
});

describe('isLateRepayment', () => {
  it('est en retard si EN_RETARD ou IMPAYE', () => {
    expect(isLateRepayment(makeRepayment({ status: RepaymentStatus.EN_RETARD }))).toBe(true);
    expect(isLateRepayment(makeRepayment({ status: RepaymentStatus.IMPAYE }))).toBe(true);
  });

  it("n'est pas en retard sinon", () => {
    expect(isLateRepayment(makeRepayment({ status: RepaymentStatus.PLANIFIE }))).toBe(false);
    expect(isLateRepayment(makeRepayment({ status: RepaymentStatus.PAYE }))).toBe(false);
  });
});

describe('daysLateForRepayment', () => {
  it('retourne null pour une échéance qui n’est pas en retard', () => {
    expect(daysLateForRepayment(makeRepayment({ status: RepaymentStatus.PLANIFIE }))).toBeNull();
    expect(daysLateForRepayment(makeRepayment({ status: RepaymentStatus.PAYE }))).toBeNull();
  });

  it('retourne le nombre de jours pour une échéance en retard passée', () => {
    const days = daysLateForRepayment(
      makeRepayment({ status: RepaymentStatus.EN_RETARD, dueDate: '2020-01-01T00:00:00.000Z' }),
    );
    expect(days).toBeGreaterThan(0);
  });
});
