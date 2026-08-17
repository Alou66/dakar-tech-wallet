import { Component, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';

interface NavItem {
  label: string;
  path: string;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Tableau de bord', path: '/client/dashboard' },
  { label: 'Transactions', path: '/client/transactions' },
  { label: 'Virements', path: '/client/transfers' },
  { label: 'Prêts', path: '/client/loans' },
  { label: 'Profil', path: '/client/profile' },
];

@Component({
  selector: 'app-client-layout',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './client-layout.component.html',
  styleUrl: './client-layout.component.css'
})
export class ClientLayoutComponent {
  readonly authService = inject(AuthService);
  readonly sidebarOpen = signal(false);
  readonly navItems = NAV_ITEMS;

  readonly currentUser = this.authService.currentUser;

  get fullName(): string {
    const user = this.currentUser();
    return user ? `${user.firstName} ${user.lastName}` : '';
  }

  toggleSidebar(): void {
    this.sidebarOpen.update(open => !open);
  }

  closeSidebar(): void {
    this.sidebarOpen.set(false);
  }

  logout(): void {
    this.authService.logout();
  }
}
