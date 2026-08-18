import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, of, throwError } from 'rxjs';

import { environment } from '../../../environments/environment';
import { CreditScore } from '../models/credit-score.model';

@Injectable({ providedIn: 'root' })
export class CreditScoreService {
  private readonly http = inject(HttpClient);
  private readonly resourceUrl = `${environment.apiUrl}/credit-scores`;

  getAll(): Observable<CreditScore[]> {
    return this.http.get<CreditScore[]>(this.resourceUrl);
  }

  /**
   * Le score est calculé et persisté automatiquement côté serveur (après
   * chaque remboursement et via une synchronisation périodique) : un client
   * qui n'a encore aucun prêt n'a simplement pas d'enregistrement (404),
   * traité ici comme une absence de score plutôt qu'une erreur.
   */
  getByUser(userId: string): Observable<CreditScore | undefined> {
    return this.http.get<CreditScore>(`${this.resourceUrl}/user/${userId}`).pipe(
      catchError((error: HttpErrorResponse) => (error.status === 404 ? of(undefined) : throwError(() => error))),
    );
  }
}
