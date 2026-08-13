import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';
import { Repayment } from '../models/repayment.model';

@Injectable({ providedIn: 'root' })
export class RepaymentService {
  private readonly http = inject(HttpClient);
  private readonly resourceUrl = `${environment.apiUrl}/repayments`;

  getById(id: string): Observable<Repayment> {
    return this.http.get<Repayment>(`${this.resourceUrl}/${id}`);
  }

  getByLoan(loanId: string): Observable<Repayment[]> {
    const params = new HttpParams().set('loanId', loanId);
    return this.http.get<Repayment[]>(this.resourceUrl, { params });
  }

  getByUser(userId: string): Observable<Repayment[]> {
    const params = new HttpParams().set('userId', userId);
    return this.http.get<Repayment[]>(this.resourceUrl, { params });
  }

  create(repayment: Omit<Repayment, 'id'>): Observable<Repayment> {
    return this.http.post<Repayment>(this.resourceUrl, repayment);
  }
}
