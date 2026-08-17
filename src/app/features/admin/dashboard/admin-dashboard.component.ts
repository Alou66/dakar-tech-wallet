import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

import { AdminDashboardData, DashboardService } from '../../../core/services/dashboard.service';
import { computeAdminDashboardStats } from '../../../core/utils/admin-dashboard-stats.util';

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './admin-dashboard.component.html',
  styleUrl: './admin-dashboard.component.css',
})
export class AdminDashboardComponent implements OnInit {
  private readonly dashboardService = inject(DashboardService);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly data = signal<AdminDashboardData | null>(null);

  readonly hasData = computed(() => {
    const dashboardData = this.data();
    if (!dashboardData) return false;
    return (
      dashboardData.users.length > 0 ||
      dashboardData.loans.length > 0 ||
      dashboardData.transactions.length > 0
    );
  });

  readonly stats = computed(() => {
    const dashboardData = this.data();
    if (!dashboardData) return null;
    return computeAdminDashboardStats(
      dashboardData.users,
      dashboardData.loans,
      dashboardData.transactions,
    );
  });

  ngOnInit(): void {
    this.load();
  }

  retry(): void {
    this.load();
  }

  formatCurrency(value: number): string {
    return new Intl.NumberFormat('fr-FR').format(value) + ' FCFA';
  }

  formatNumber(value: number): string {
    return new Intl.NumberFormat('fr-FR').format(value);
  }

  private load(): void {
    this.loading.set(true);
    this.error.set(null);

    this.dashboardService.getAdminDashboard().subscribe({
      next: (dashboardData) => {
        this.data.set(dashboardData);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Impossible de charger les statistiques du tableau de bord.');
        this.loading.set(false);
      },
    });
  }
}
