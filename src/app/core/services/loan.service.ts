import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, of } from 'rxjs';

import { environment } from '../../../environments/environment';
import { Loan, LoanStatus } from '../models/loan.model';
import { Repayment } from '../models/repayment.model';
import { deriveLoanStatus } from '../utils/loan-status.util';

@Injectable({ providedIn: 'root' })
export class LoanService {
  private readonly http = inject(HttpClient);
  private readonly resourceUrl = `${environment.apiUrl}/loans`;

  getAll(): Observable<Loan[]> {
    return this.http.get<Loan[]>(this.resourceUrl);
  }

  getById(id: string): Observable<Loan> {
    return this.http.get<Loan>(`${this.resourceUrl}/${id}`);
  }

  getByUser(userId: string): Observable<Loan[]> {
    const params = new HttpParams().set('userId', userId);
    return this.http.get<Loan[]>(this.resourceUrl, { params });
  }

  create(loan: Omit<Loan, 'id'>): Observable<Loan> {
    return this.http.post<Loan>(this.resourceUrl, loan);
  }

  update(id: string, changes: Partial<Loan>): Observable<Loan> {
    return this.http.patch<Loan>(`${this.resourceUrl}/${id}`, changes);
  }

  updateStatus(id: string, status: LoanStatus): Observable<Loan> {
    return this.update(id, { status });
  }

  /**
   * Aligne le statut du prêt sur l'état réel de son échéancier (voir
   * `deriveLoanStatus`) : bascule EN_RETARD dès qu'une échéance l'est,
   * revient à EN_COURS une fois toutes régularisées. N'envoie aucune
   * requête si le statut dérivé est déjà celui du prêt (idempotent).
   */
  syncStatusFromRepayments(loan: Loan, repayments: Repayment[]): Observable<Loan> {
    const nextStatus = deriveLoanStatus(loan, repayments);
    if (nextStatus === loan.status) {
      return of(loan);
    }
    return this.updateStatus(loan.id, nextStatus);
  }
}
