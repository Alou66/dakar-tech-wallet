import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, forkJoin, map } from 'rxjs';

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

  getByUser(userId: string): Observable<Transaction[]> {
    const asSender = this.http.get<Transaction[]>(this.resourceUrl, {
      params: new HttpParams().set('senderId', userId),
    });
    const asReceiver = this.http.get<Transaction[]>(this.resourceUrl, {
      params: new HttpParams().set('receiverId', userId),
    });

    return forkJoin([asSender, asReceiver]).pipe(
      map(([sent, received]) => {
        const byId = new Map<string, Transaction>();
        [...sent, ...received].forEach((transaction) => byId.set(transaction.id, transaction));
        return Array.from(byId.values()).sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
      }),
    );
  }

  create(transaction: Omit<Transaction, 'id' | 'createdAt'>): Observable<Transaction> {
    return this.http.post<Transaction>(this.resourceUrl, transaction);
  }
}
