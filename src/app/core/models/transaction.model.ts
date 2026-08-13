export enum TransactionType {
  DEPOT = 'DEPOT',
  RETRAIT = 'RETRAIT',
  VIREMENT = 'VIREMENT',
  DECAISSEMENT_PRET = 'DECAISSEMENT_PRET',
  REMBOURSEMENT_PRET = 'REMBOURSEMENT_PRET',
}

export enum TransactionStatus {
  EN_ATTENTE = 'EN_ATTENTE',
  REUSSIE = 'REUSSIE',
  ECHOUEE = 'ECHOUEE',
  ANNULEE = 'ANNULEE',
}

export interface Transaction {
  id: string;
  type: TransactionType;
  status: TransactionStatus;
  amount: number;
  senderId?: string;
  receiverId?: string;
  relatedLoanId?: string;
  description?: string;
  createdAt: string;
}
