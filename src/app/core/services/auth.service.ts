import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Observable, map, tap } from 'rxjs';

import { environment } from '../../../environments/environment';
import { User } from '../models/user.model';

const CURRENT_USER_STORAGE_KEY = 'dakar-tech-wallet.currentUser';
const TOKEN_STORAGE_KEY = 'dakar-tech-wallet.token';

interface LoginResponse {
  token: string;
  user: User;
}

export interface RegisterRequest {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  password: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly resourceUrl = `${environment.apiUrl}/auth`;

  private readonly currentUserSignal = signal<User | null>(this.readStoredUser());

  /** Session courante exposée de façon réactive via Signals. */
  readonly currentUser = this.currentUserSignal.asReadonly();

  /** Conservé pour les consommateurs RxJS existants. */
  readonly currentUser$: Observable<User | null> = toObservable(this.currentUserSignal);

  login(email: string, password: string): Observable<User> {
    return this.http.post<LoginResponse>(`${this.resourceUrl}/login`, { email, password }).pipe(
      tap(({ token, user }) => this.setSession(token, user)),
      map(({ user }) => user),
    );
  }

  register(request: RegisterRequest): Observable<User> {
    return this.http.post<LoginResponse>(`${this.resourceUrl}/register`, request).pipe(
      tap(({ token, user }) => this.setSession(token, user)),
      map(({ user }) => user),
    );
  }

  logout(): void {
    localStorage.removeItem(CURRENT_USER_STORAGE_KEY);
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    this.currentUserSignal.set(null);
  }

  getCurrentUser(): User | null {
    return this.currentUserSignal();
  }

  /** Rafraîchit la session avec les données utilisateur à jour (ex : après modification du profil). */
  updateCurrentUser(user: User): void {
    localStorage.setItem(CURRENT_USER_STORAGE_KEY, JSON.stringify(user));
    this.currentUserSignal.set(user);
  }

  getToken(): string | null {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  }

  isAuthenticated(): boolean {
    return this.currentUserSignal() !== null;
  }

  private setSession(token: string, user: User): void {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
    localStorage.setItem(CURRENT_USER_STORAGE_KEY, JSON.stringify(user));
    this.currentUserSignal.set(user);
  }

  private readStoredUser(): User | null {
    const raw = localStorage.getItem(CURRENT_USER_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  }
}
