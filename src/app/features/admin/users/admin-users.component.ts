import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

import { AdminUsersManagementData, DashboardService } from '../../../core/services/dashboard.service';
import { UserService } from '../../../core/services/user.service';
import { CreditScore, CreditScoreCategory } from '../../../core/models/credit-score.model';
import { User, UserRole, UserStatus } from '../../../core/models/user.model';
import { creditScoreCategoryClass, creditScoreCategoryLabel } from '../../../core/utils/credit-score.util';

type RoleFilter = UserRole | 'ALL';
type StatusFilter = UserStatus | 'ALL';
type PendingAction = { userId: string; action: 'suspend' | 'activate' };

@Component({
  selector: 'app-admin-users',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './admin-users.component.html',
  styleUrl: './admin-users.component.css',
})
export class AdminUsersComponent implements OnInit {
  private readonly dashboardService = inject(DashboardService);
  private readonly userService = inject(UserService);

  readonly UserRole = UserRole;
  readonly UserStatus = UserStatus;

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly data = signal<AdminUsersManagementData | null>(null);

  readonly searchTerm = signal('');
  readonly roleFilter = signal<RoleFilter>('ALL');
  readonly statusFilter = signal<StatusFilter>('ALL');

  readonly pendingAction = signal<PendingAction | null>(null);
  readonly actionSubmitting = signal(false);
  readonly actionError = signal<string | null>(null);

  readonly hasUsers = computed(() => (this.data()?.users.length ?? 0) > 0);

  private readonly creditScoreByUserId = computed(() => {
    const map = new Map<string, CreditScore>();
    for (const score of this.data()?.creditScores ?? []) {
      map.set(score.userId, score);
    }
    return map;
  });

  readonly filteredUsers = computed(() => {
    const users = this.data()?.users ?? [];
    const term = this.searchTerm().trim().toLowerCase();
    const role = this.roleFilter();
    const status = this.statusFilter();

    return users.filter((user) => {
      if (role !== 'ALL' && user.role !== role) return false;
      if (status !== 'ALL' && user.status !== status) return false;
      if (term) {
        const fullName = `${user.firstName} ${user.lastName}`.toLowerCase();
        const matchesTerm =
          fullName.includes(term) ||
          user.email.toLowerCase().includes(term) ||
          user.accountNumber.toLowerCase().includes(term);
        if (!matchesTerm) return false;
      }
      return true;
    });
  });

  readonly hasFilteredResults = computed(() => this.filteredUsers().length > 0);

  readonly hasActiveFilters = computed(
    () => this.searchTerm().trim().length > 0 || this.roleFilter() !== 'ALL' || this.statusFilter() !== 'ALL',
  );

  readonly pendingActionUser = computed(() => {
    const pending = this.pendingAction();
    if (!pending) return null;
    return this.data()?.users.find((user) => user.id === pending.userId) ?? null;
  });

  ngOnInit(): void {
    this.load();
  }

  retry(): void {
    this.load();
  }

  onSearchChange(event: Event): void {
    this.searchTerm.set((event.target as HTMLInputElement).value);
  }

  onRoleFilterChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as RoleFilter;
    this.roleFilter.set(value);
  }

  onStatusFilterChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as StatusFilter;
    this.statusFilter.set(value);
  }

  resetFilters(): void {
    this.searchTerm.set('');
    this.roleFilter.set('ALL');
    this.statusFilter.set('ALL');
  }

  isClient(user: User): boolean {
    return user.role === UserRole.CLIENT;
  }

  requestSuspend(user: User): void {
    if (!this.isClient(user) || user.status !== UserStatus.ACTIVE) return;
    this.actionError.set(null);
    this.pendingAction.set({ userId: user.id, action: 'suspend' });
  }

  requestActivate(user: User): void {
    if (!this.isClient(user) || user.status !== UserStatus.SUSPENDED) return;
    this.actionError.set(null);
    this.pendingAction.set({ userId: user.id, action: 'activate' });
  }

  cancelAction(): void {
    if (this.actionSubmitting()) return;
    this.pendingAction.set(null);
    this.actionError.set(null);
  }

  confirmAction(): void {
    const pending = this.pendingAction();
    if (!pending || this.actionSubmitting()) return;

    const user = this.data()?.users.find((u) => u.id === pending.userId);
    if (!user || !this.isClient(user)) {
      this.pendingAction.set(null);
      return;
    }

    this.actionSubmitting.set(true);
    this.actionError.set(null);

    const request =
      pending.action === 'suspend' ? this.userService.suspend(user.id) : this.userService.activate(user.id);

    request.subscribe({
      next: (updatedUser) => {
        this.data.update((current) =>
          current
            ? { ...current, users: current.users.map((u) => (u.id === updatedUser.id ? updatedUser : u)) }
            : current,
        );
        this.actionSubmitting.set(false);
        this.pendingAction.set(null);
      },
      error: () => {
        this.actionError.set("Impossible de mettre à jour le statut de l'utilisateur. Veuillez réessayer.");
        this.actionSubmitting.set(false);
      },
    });
  }

  creditScoreFor(userId: string): CreditScore | undefined {
    return this.creditScoreByUserId().get(userId);
  }

  roleLabel(role: UserRole): string {
    switch (role) {
      case UserRole.ADMIN:
        return 'Admin';
      case UserRole.CLIENT:
        return 'Client';
      default:
        return role;
    }
  }

  statusLabel(status: UserStatus): string {
    switch (status) {
      case UserStatus.ACTIVE:
        return 'Actif';
      case UserStatus.SUSPENDED:
        return 'Suspendu';
      default:
        return status;
    }
  }

  statusClass(status: UserStatus): string {
    switch (status) {
      case UserStatus.ACTIVE:
        return 'badge-success';
      case UserStatus.SUSPENDED:
        return 'badge-danger';
      default:
        return 'badge-neutral';
    }
  }

  creditScoreCategoryLabel(category: CreditScoreCategory): string {
    return creditScoreCategoryLabel(category);
  }

  creditScoreCategoryClass(category: CreditScoreCategory): string {
    return creditScoreCategoryClass(category);
  }

  formatCurrency(value: number): string {
    return new Intl.NumberFormat('fr-FR').format(value) + ' FCFA';
  }

  formatDate(dateString?: string): string {
    if (!dateString) return '—';
    return new Date(dateString).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }

  private load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.pendingAction.set(null);
    this.actionError.set(null);

    this.dashboardService.getAdminUsersManagement().subscribe({
      next: (data) => {
        this.data.set(data);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Impossible de charger la liste des utilisateurs.');
        this.loading.set(false);
      },
    });
  }
}
