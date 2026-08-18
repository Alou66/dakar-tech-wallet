import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';
import { User } from '../models/user.model';

export interface UpdateProfileRequest {
  firstName: string;
  lastName: string;
  phone: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

@Injectable({ providedIn: 'root' })
export class UserService {
  private readonly http = inject(HttpClient);
  private readonly resourceUrl = `${environment.apiUrl}/users`;

  getAll(): Observable<User[]> {
    return this.http.get<User[]>(this.resourceUrl);
  }

  /** Profil de l'utilisateur authentifié, utilisé par la page "Profil". */
  getMe(): Observable<User> {
    return this.http.get<User>(`${this.resourceUrl}/me`);
  }

  updateProfile(request: UpdateProfileRequest): Observable<User> {
    return this.http.put<User>(`${this.resourceUrl}/me`, request);
  }

  changePassword(request: ChangePasswordRequest): Observable<void> {
    return this.http.post<void>(`${this.resourceUrl}/me/password`, request);
  }

  getById(id: string): Observable<User> {
    return this.http.get<User>(`${this.resourceUrl}/${id}`);
  }

  searchByAccountNumber(accountNumber: string): Observable<User[]> {
    const params = new HttpParams().set('accountNumber', accountNumber);
    return this.http.get<User[]>(`${this.resourceUrl}/search`, { params });
  }

  suspend(id: string): Observable<User> {
    return this.http.post<User>(`${this.resourceUrl}/${id}/suspend`, {});
  }

  activate(id: string): Observable<User> {
    return this.http.post<User>(`${this.resourceUrl}/${id}/activate`, {});
  }
}
