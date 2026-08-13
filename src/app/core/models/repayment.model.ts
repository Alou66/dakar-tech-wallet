export enum RepaymentStatus {
  PLANIFIE = 'PLANIFIE',
  PAYE = 'PAYE',
  EN_RETARD = 'EN_RETARD',
  IMPAYE = 'IMPAYE',
}

export interface Repayment {
  id: string;
  loanId: string;
  userId: string;
  installmentNumber: number;
  dueDate: string;
  amountDue: number;
  amountPaid?: number;
  paymentDate?: string;
  lateFee?: number;
  status: RepaymentStatus;
}
