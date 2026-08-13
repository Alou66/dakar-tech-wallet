export enum LoanStatus {
  EN_ATTENTE = 'EN_ATTENTE',
  APPROUVE = 'APPROUVE',
  REJETE = 'REJETE',
  EN_COURS = 'EN_COURS',
  EN_RETARD = 'EN_RETARD',
  REMBOURSE = 'REMBOURSE',
}

export interface Loan {
  id: string;
  userId: string;
  amount: number;
  interestRate: number;
  durationMonths: number;
  monthlyPayment: number;
  remainingBalance: number;
  status: LoanStatus;
  purpose?: string;
  requestDate: string;
  approvalDate?: string;
  approvedBy?: string;
  startDate?: string;
  endDate?: string;
}
