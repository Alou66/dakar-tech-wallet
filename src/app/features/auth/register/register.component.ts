import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { AuthService } from '../../../core/services/auth.service';
import { spaceUrlForRole } from '../../../core/guards/auth.guard';
import { passwordMatchValidator } from '../../../shared/validators/password-match.validator';

const PHONE_PATTERN = /^\+221[0-9]{9}$/;

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './register.component.html',
  styleUrl: './register.component.css',
})
export class RegisterComponent {
  private readonly fb = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  readonly loading = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group(
    {
      firstName: ['', [Validators.required, Validators.maxLength(100)]],
      lastName: ['', [Validators.required, Validators.maxLength(100)]],
      email: ['', [Validators.required, Validators.email]],
      phone: ['', [Validators.required, Validators.pattern(PHONE_PATTERN)]],
      password: ['', [Validators.required, Validators.minLength(8)]],
      confirmPassword: ['', [Validators.required]],
    },
    { validators: passwordMatchValidator('password', 'confirmPassword') },
  );

  get firstNameControl() {
    return this.form.controls.firstName;
  }

  get lastNameControl() {
    return this.form.controls.lastName;
  }

  get emailControl() {
    return this.form.controls.email;
  }

  get phoneControl() {
    return this.form.controls.phone;
  }

  get passwordControl() {
    return this.form.controls.password;
  }

  get confirmPasswordControl() {
    return this.form.controls.confirmPassword;
  }

  onSubmit(): void {
    if (this.loading()) {
      return;
    }

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.loading.set(true);
    this.errorMessage.set(null);

    const { confirmPassword, ...request } = this.form.getRawValue();

    this.authService.register(request).subscribe({
      next: (user) => {
        this.loading.set(false);
        this.router.navigateByUrl(spaceUrlForRole(user.role));
      },
      error: (err: { error?: { message?: string } }) => {
        this.loading.set(false);
        this.errorMessage.set(err?.error?.message ?? "L'inscription a échoué. Veuillez réessayer.");
      },
    });
  }
}
