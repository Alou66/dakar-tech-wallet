import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map, switchMap } from 'rxjs';

import { environment } from '../../../environments/environment';
import { CreditScore } from '../models/credit-score.model';
import { Repayment } from '../models/repayment.model';
import { computeCreditScore } from '../utils/credit-score.util';

@Injectable({ providedIn: 'root' })
export class CreditScoreService {
  private readonly http = inject(HttpClient);
  private readonly resourceUrl = `${environment.apiUrl}/creditScores`;

  getAll(): Observable<CreditScore[]> {
    return this.http.get<CreditScore[]>(this.resourceUrl);
  }

  getByUser(userId: string): Observable<CreditScore | undefined> {
    const params = new HttpParams().set('userId', userId);
    return this.http
      .get<CreditScore[]>(this.resourceUrl, { params })
      .pipe(map((scores) => scores[0]));
  }

  create(creditScore: Omit<CreditScore, 'id'>): Observable<CreditScore> {
    return this.http.post<CreditScore>(this.resourceUrl, creditScore);
  }

  update(id: string, changes: Partial<CreditScore>): Observable<CreditScore> {
    return this.http.patch<CreditScore>(`${this.resourceUrl}/${id}`, changes);
  }

  /**
   * Recalcule le score de solvabilité à partir de l'historique réel des
   * remboursements du client (jamais à partir de la seule valeur déjà
   * stockée) puis le sauvegarde dans /creditScores : mise à jour de
   * l'enregistrement existant s'il y en a un, sinon création.
   */
  recalculateForUser(userId: string, repayments: Repayment[]): Observable<CreditScore> {
    const breakdown = computeCreditScore(repayments);
    const payload: Omit<CreditScore, 'id'> = {
      userId,
      score: breakdown.score,
      category: breakdown.category,
      totalLoans: breakdown.totalLoans,
      onTimeRepayments: breakdown.onTimeCount,
      lateRepayments: breakdown.lateCount,
      calculatedAt: new Date().toISOString(),
    };

    return this.getByUser(userId).pipe(
      switchMap((existing) => (existing ? this.update(existing.id, payload) : this.create(payload))),
    );
  }
}
