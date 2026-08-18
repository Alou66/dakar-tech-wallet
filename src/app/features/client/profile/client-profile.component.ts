import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { AuthService } from '../../../core/services/auth.service';
import { UserService } from '../../../core/services/user.service';
import { User, UserRole, UserStatus } from '../../../core/models/user.model';
import { passwordMatchValidator } from '../../../shared/validators/password-match.validator';

const PHONE_PATTERN = /^\+221[0-9]{9}$/;

@Component({
  selector: 'app-client-profile',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './client-profile.component.html',
  styleUrl: './client-profile.component.css',
})
export class ClientProfileComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly userService = inject(UserService);
  private readonly authService = inject(AuthService);

  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly user = signal<User | null>(null);

  readonly editingProfile = signal(false);
  readonly savingProfile = signal(false);
  readonly profileError = signal<string | null>(null);
  readonly profileSuccess = signal<string | null>(null);

  readonly changingPassword = signal(false);
  readonly passwordError = signal<string | null>(null);
  readonly passwordSuccess = signal<string | null>(null);

  readonly initials = computed(() => {
    const user = this.user();
    if (!user) return '';
    return `${user.firstName.charAt(0)}${user.lastName.charAt(0)}`.toUpperCase();
  });

  readonly profileForm = this.fb.nonNullable.group({
    firstName: ['', [Validators.required, Validators.maxLength(100)]],
    lastName: ['', [Validators.required, Validators.maxLength(100)]],
    phone: ['', [Validators.required, Validators.pattern(PHONE_PATTERN)]],
  });

  readonly passwordForm = this.fb.nonNullable.group(
    {
      currentPassword: ['', [Validators.required]],
      newPassword: ['', [Validators.required, Validators.minLength(8)]],
      confirmNewPassword: ['', [Validators.required]],
    },
    { validators: passwordMatchValidator('newPassword', 'confirmNewPassword') },
  );

  get firstNameControl() {
    return this.profileForm.controls.firstName;
  }

  get lastNameControl() {
    return this.profileForm.controls.lastName;
  }

  get phoneControl() {
    return this.profileForm.controls.phone;
  }

  get currentPasswordControl() {
    return this.passwordForm.controls.currentPassword;
  }

  get newPasswordControl() {
    return this.passwordForm.controls.newPassword;
  }

  get confirmNewPasswordControl() {
    return this.passwordForm.controls.confirmNewPassword;
  }

  ngOnInit(): void {
    this.loadProfile();
  }

  retry(): void {
    this.loadProfile();
  }

  private loadProfile(): void {
    this.loading.set(true);
    this.loadError.set(null);

    this.userService.getMe().subscribe({
      next: (user) => {
        this.user.set(user);
        this.profileForm.reset({
          firstName: user.firstName,
          lastName: user.lastName,
          phone: user.phone,
        });
        this.loading.set(false);
      },
      error: () => {
        this.loadError.set('Impossible de charger votre profil.');
        this.loading.set(false);
      },
    });
  }

  startEditProfile(): void {
    this.profileError.set(null);
    this.profileSuccess.set(null);
    this.editingProfile.set(true);
  }

  cancelEditProfile(): void {
    const user = this.user();
    if (user) {
      this.profileForm.reset({
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
      });
    }
    this.profileError.set(null);
    this.editingProfile.set(false);
  }

  saveProfile(): void {
    if (this.savingProfile()) {
      return;
    }

    if (this.profileForm.invalid) {
      this.profileForm.markAllAsTouched();
      return;
    }

    this.savingProfile.set(true);
    this.profileError.set(null);
    this.profileSuccess.set(null);

    this.userService.updateProfile(this.profileForm.getRawValue()).subscribe({
      next: (user) => {
        this.user.set(user);
        this.authService.updateCurrentUser(user);
        this.editingProfile.set(false);
        this.savingProfile.set(false);
        this.profileSuccess.set('Vos informations ont été mises à jour.');
      },
      error: (err: { error?: { message?: string } }) => {
        this.savingProfile.set(false);
        this.profileError.set(err?.error?.message ?? 'La mise à jour a échoué. Veuillez réessayer.');
      },
    });
  }

  changePassword(): void {
    if (this.changingPassword()) {
      return;
    }

    if (this.passwordForm.invalid) {
      this.passwordForm.markAllAsTouched();
      return;
    }

    this.changingPassword.set(true);
    this.passwordError.set(null);
    this.passwordSuccess.set(null);

    const { confirmNewPassword, ...request } = this.passwordForm.getRawValue();

    this.userService.changePassword(request).subscribe({
      next: () => {
        this.changingPassword.set(false);
        this.passwordSuccess.set('Votre mot de passe a été modifié.');
        this.passwordForm.reset({ currentPassword: '', newPassword: '', confirmNewPassword: '' });
      },
      error: (err: { error?: { message?: string } }) => {
        this.changingPassword.set(false);
        this.passwordError.set(err?.error?.message ?? 'La modification du mot de passe a échoué.');
      },
    });
  }

  formatDate(value: string): string {
    return new Date(value).toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  roleLabel(role: UserRole): string {
    return role === UserRole.ADMIN ? 'Administrateur' : 'Client';
  }

  statusLabel(status: UserStatus): string {
    return status === UserStatus.ACTIVE ? 'Actif' : 'Suspendu';
  }
}
