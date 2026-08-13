import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Observable, map, tap } from 'rxjs';

import { environment } from '../../../environments/environment';
import { User } from '../models/user.model';

const CURRENT_USER_STORAGE_KEY = 'dakar-tech-wallet.currentUser';

/**
 * Authentification temporaire adossée à JSON Server : les utilisateurs sont
 * recherchés par email, sans mot de passe ni jeton. À remplacer par un vrai
 * mécanisme (JWT, session serveur, ...) lors de la migration vers Spring Boot.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly resourceUrl = `${environment.apiUrl}/users`;

  private readonly currentUserSignal = signal<User | null>(this.readStoredUser());

  /** Session courante exposée de façon réactive via Signals. */
  readonly currentUser = this.currentUserSignal.asReadonly();

  /** Conservé pour les consommateurs RxJS existants. */
  readonly currentUser$: Observable<User | null> = toObservable(this.currentUserSignal);

  login(email: string): Observable<User> {
    const params = new HttpParams().set('email', email);
    return this.http.get<User[]>(this.resourceUrl, { params }).pipe(
      map((users) => {
        const user = users[0];
        if (!user) {
          throw new Error('Aucun utilisateur trouvé pour cet email.');
        }
        return user;
      }),
      tap((user) => this.setCurrentUser(user)),
    );
  }

  logout(): void {
    localStorage.removeItem(CURRENT_USER_STORAGE_KEY);
    this.currentUserSignal.set(null);
  }

  getCurrentUser(): User | null {
    return this.currentUserSignal();
  }

  isAuthenticated(): boolean {
    return this.currentUserSignal() !== null;
  }

  private setCurrentUser(user: User): void {
    localStorage.setItem(CURRENT_USER_STORAGE_KEY, JSON.stringify(user));
    this.currentUserSignal.set(user);
  }

  private readStoredUser(): User | null {
    const raw = localStorage.getItem(CURRENT_USER_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  }
}
