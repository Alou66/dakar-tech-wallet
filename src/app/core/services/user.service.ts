import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';
import { User, UserStatus } from '../models/user.model';

@Injectable({ providedIn: 'root' })
export class UserService {
  private readonly http = inject(HttpClient);
  private readonly resourceUrl = `${environment.apiUrl}/users`;

  getAll(): Observable<User[]> {
    return this.http.get<User[]>(this.resourceUrl);
  }

  getById(id: string): Observable<User> {
    return this.http.get<User>(`${this.resourceUrl}/${id}`);
  }

  searchByAccountNumber(accountNumber: string): Observable<User[]> {
    const params = new HttpParams().set('accountNumber', accountNumber);
    return this.http.get<User[]>(this.resourceUrl, { params });
  }

  create(user: Omit<User, 'id'>): Observable<User> {
    return this.http.post<User>(this.resourceUrl, user);
  }

  update(id: string, changes: Partial<User>): Observable<User> {
    return this.http.patch<User>(`${this.resourceUrl}/${id}`, changes);
  }

  updateStatus(id: string, status: UserStatus): Observable<User> {
    return this.update(id, { status });
  }

  suspend(id: string): Observable<User> {
    return this.updateStatus(id, UserStatus.SUSPENDED);
  }

  activate(id: string): Observable<User> {
    return this.updateStatus(id, UserStatus.ACTIVE);
  }
}
