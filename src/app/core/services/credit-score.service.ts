import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { environment } from '../../../environments/environment';
import { CreditScore } from '../models/credit-score.model';

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
}
