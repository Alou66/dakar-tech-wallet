export enum CreditScoreCategory {
  EXCELLENT = 'EXCELLENT',
  BON = 'BON',
  A_RISQUE = 'A_RISQUE',
  MAUVAIS_PAYEUR = 'MAUVAIS_PAYEUR',
}

export interface CreditScore {
  id: string;
  userId: string;
  score: number;
  category: CreditScoreCategory;
  totalLoans: number;
  onTimeRepayments: number;
  lateRepayments: number;
  calculatedAt: string;
}
