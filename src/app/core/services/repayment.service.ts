import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, concatMap, forkJoin, from, map, of, retry, switchMap, timer, toArray } from 'rxjs';

import { environment } from '../../../environments/environment';
import { Loan } from '../models/loan.model';
import { Repayment, RepaymentStatus } from '../models/repayment.model';
import { generateInstallments } from '../utils/loan-schedule.util';
import { computeLateFee, detectOverdueRepayments } from '../utils/repayment-late.util';

@Injectable({ providedIn: 'root' })
export class RepaymentService {
  private readonly http = inject(HttpClient);
  private readonly resourceUrl = `${environment.apiUrl}/repayments`;

  /**
   * json-server (--watch) recharge brièvement son routeur après chaque
   * écriture (POST/PATCH) : une requête déclenchée juste après une autre
   * peut tomber pendant cette fenêtre et échouer avec une erreur de
   * connexion. On ré-essaie donc quelques fois avec un court délai
   * croissant plutôt que de remonter l'échec immédiatement.
   */
  private static readonly RETRY_ATTEMPTS = 3;
  private static readonly RETRY_BASE_DELAY_MS = 200;

  private withRetry<T>(source: Observable<T>): Observable<T> {
    return source.pipe(
      retry({
        count: RepaymentService.RETRY_ATTEMPTS,
        delay: (_error, retryCount) => timer(RepaymentService.RETRY_BASE_DELAY_MS * retryCount),
      }),
    );
  }

  getAll(): Observable<Repayment[]> {
    return this.http.get<Repayment[]>(this.resourceUrl);
  }

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

  update(id: string, changes: Partial<Repayment>): Observable<Repayment> {
    return this.http.patch<Repayment>(`${this.resourceUrl}/${id}`, changes);
  }

  /**
   * Génère et persiste l'échéancier d'un prêt tout juste décaissé (une
   * échéance PLANIFIE par mois de sa durée, voir `generateInstallments`).
   *
   * Idempotent : relit d'abord les échéances déjà persistées pour ce prêt
   * et ne crée que celles qui manquent (par `installmentNumber`), afin de
   * pouvoir être rappelée sans risque après un échec partiel (aucun
   * doublon). Les créations sont envoyées une par une (et non en parallèle)
   * pour ne pas déclencher plusieurs rechargements concurrents de
   * json-server, chacune protégée par `withRetry`.
   */
  createSchedule(loan: Loan, startDate: Date): Observable<Repayment[]> {
    const installments = generateInstallments(loan, startDate);
    if (installments.length === 0) {
      return of([]);
    }

    return this.withRetry(this.getByLoan(loan.id)).pipe(
      switchMap((existing) => {
        const existingNumbers = new Set(existing.map((repayment) => repayment.installmentNumber));
        const missing = installments.filter((installment) => !existingNumbers.has(installment.installmentNumber));
        if (missing.length === 0) {
          return of(existing);
        }

        return from(missing).pipe(
          concatMap((installment) => this.withRetry(this.create(installment))),
          toArray(),
          map((created) =>
            [...existing, ...created].sort((a, b) => a.installmentNumber - b.installmentNumber),
          ),
        );
      }),
    );
  }

  /**
   * Reclasse EN_RETARD les échéances PLANIFIE dont la date est dépassée et
   * persiste ce changement, en calculant au passage leur pénalité de retard
   * (`computeLateFee`). Les échéances déjà PAYE ne sont jamais touchées, et
   * une échéance déjà EN_RETARD n'est jamais retraitée : la pénalité n'est
   * donc calculée et persistée qu'une seule fois, au moment de la
   * transition. Renvoie la liste fournie avec les échéances concernées
   * mises à jour.
   */
  syncOverdueStatuses(repayments: Repayment[]): Observable<Repayment[]> {
    const overdue = detectOverdueRepayments(repayments);
    if (overdue.length === 0) {
      return of(repayments);
    }

    const byId = new Map(repayments.map((repayment) => [repayment.id, repayment]));

    return forkJoin(
      overdue.map((item) => {
        const amountDue = byId.get(item.id)?.amountDue ?? 0;
        return this.update(item.id, {
          status: RepaymentStatus.EN_RETARD,
          lateFee: computeLateFee(amountDue),
        });
      }),
    ).pipe(
      map((updated) => {
        const updatedById = new Map(updated.map((repayment) => [repayment.id, repayment]));
        return repayments.map((repayment) => updatedById.get(repayment.id) ?? repayment);
      }),
    );
  }
}
