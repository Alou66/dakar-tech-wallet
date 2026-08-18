import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';
import { Transaction } from '../models/transaction.model';

@Injectable({ providedIn: 'root' })
export class TransactionService {
  private readonly http = inject(HttpClient);
  private readonly resourceUrl = `${environment.apiUrl}/transactions`;

  getAll(): Observable<Transaction[]> {
    return this.http.get<Transaction[]>(this.resourceUrl);
  }

  getById(id: string): Observable<Transaction> {
    return this.http.get<Transaction>(`${this.resourceUrl}/${id}`);
  }

  getByLoan(loanId: string): Observable<Transaction[]> {
    return this.http.get<Transaction[]>(`${this.resourceUrl}/loan/${loanId}`);
  }

  getByUser(userId: string): Observable<Transaction[]> {
    return this.http.get<Transaction[]>(`${this.resourceUrl}/user/${userId}`);
  }

  /**
   * Virement débité/crédité de façon atomique côté serveur : l'expéditeur
   * est déduit du token JWT, jamais transmis par le client.
   */
  transfer(beneficiaryAccountNumber: string, amount: number, description?: string): Observable<Transaction> {
    return this.http.post<Transaction>(`${this.resourceUrl}/transfer`, {
      beneficiaryAccountNumber,
      amount,
      description: description || undefined,
    });
  }
}
