import { HttpClient } from '@angular/common/http';
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
    return this.http.get<Repayment[]>(`${this.resourceUrl}/loan/${loanId}`);
  }

  getByUser(userId: string): Observable<Repayment[]> {
    return this.http.get<Repayment[]>(`${this.resourceUrl}/user/${userId}`);
  }

  /** Paie une échéance précise (capital dû + pénalité de retard éventuelle), débit et mise à jour atomiques côté serveur. */
  payInstallment(repaymentId: string): Observable<Repayment> {
    return this.http.post<Repayment>(`${this.resourceUrl}/${repaymentId}/pay`, {});
  }

  /** Rembourse en une fois toutes les échéances encore dues d'un prêt. */
  payTotal(loanId: string): Observable<void> {
    return this.http.post<void>(`${this.resourceUrl}/loan/${loanId}/pay-total`, {});
  }
}
