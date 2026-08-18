import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';
import { Loan } from '../models/loan.model';

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
    return this.http.get<Loan[]>(`${this.resourceUrl}/user/${userId}`);
  }

  /** Le taux, la mensualité et le total dû sont calculés côté serveur. */
  requestLoan(amount: number, purpose: string, durationMonths: number): Observable<Loan> {
    return this.http.post<Loan>(this.resourceUrl, { amount, purpose, durationMonths });
  }

  /**
   * Approuve, décaisse et génère l'échéancier en une seule opération
   * atomique côté serveur (voir `LoanService.approve` côté backend).
   */
  approve(loanId: string): Observable<Loan> {
    return this.http.post<Loan>(`${this.resourceUrl}/${loanId}/approve`, {});
  }

  reject(loanId: string): Observable<Loan> {
    return this.http.post<Loan>(`${this.resourceUrl}/${loanId}/reject`, {});
  }
}
